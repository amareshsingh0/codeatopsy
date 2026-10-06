import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getStore } from "@codeautopsy/db";
import { Problem } from "@codeautopsy/schemas";
import { getFullProblem } from "@/lib/problems";
import { dispatchExecution } from "@/lib/dispatch";

const MAX_SOURCE = 200_000;
const MAX_TEXT = 100_000;

/**
 * POST /api/submissions
 *   { problemId, source }                          — submit against a library problem
 *   { problemId: "playground", source, input?, expectedOutput? } — run ANY code
 */
export async function POST(req: Request) {
  let body: { problemId?: string; source?: string; input?: string; expectedOutput?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { problemId, source } = body;
  if (!problemId || typeof source !== "string" || source.length === 0) {
    return NextResponse.json({ error: "problemId and source are required" }, { status: 400 });
  }
  if (source.length > MAX_SOURCE) {
    return NextResponse.json({ error: "source too large (200 KB limit)" }, { status: 413 });
  }
  const input = typeof body.input === "string" ? body.input.slice(0, MAX_TEXT) : "";
  const expectedOutput =
    typeof body.expectedOutput === "string" ? body.expectedOutput.slice(0, MAX_TEXT) : "";

  let problem: Problem | null;
  if (problemId === "playground") {
    // synthesize a single-test problem around the user's own code and stdin
    problem = Problem.parse({
      slug: "playground",
      title: "Playground run",
      difficulty: "easy",
      blurb: "Standalone execution of your own code",
      statement: "Custom submission executed with your own stdin input.",
      topics: ["custom"],
      tests: [
        {
          id: "run-1",
          input,
          expectedOutput,
        },
      ],
      referenceSource: "", // standalone — no reference, trace-only autopsy
      studentSource: source,
    });
  } else {
    problem = getFullProblem(problemId);
    if (!problem) {
      return NextResponse.json({ error: `unknown problem "${problemId}"` }, { status: 404 });
    }
  }

  const store = getStore();
  const id = randomUUID();
  await store.create({ id, problemId, source });

  // fire-and-forget: the execution node calls back with the result
  const dispatch = await dispatchExecution(id, problem, source);
  if (!dispatch.ok) {
    await store.fail(id, dispatch.error ?? "dispatch failed");
    return NextResponse.json(
      { id, status: "failed", error: dispatch.error },
      { status: 502 },
    );
  }

  return NextResponse.json({ id, status: "queued" }, { status: 202 });
}
