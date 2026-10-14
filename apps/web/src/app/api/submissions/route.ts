import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getStore } from "@codeautopsy/db";
import { Problem, SubmissionRequest } from "@codeautopsy/schemas";
import { getFullProblem } from "@/lib/problems";
import { dispatchExecution } from "@/lib/dispatch";
import { configurationIssue } from "@/lib/readiness";

/**
 * POST /api/submissions
 *   { problemId, source }                                — submit against a library problem
 *   { problemId: "playground", source, input?, expectedOutput?, language? } — run ANY code
 */
export async function POST(req: Request) {
  const issue = configurationIssue();
  if (issue) return NextResponse.json({ error: issue }, { status: 503 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = SubmissionRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid submission", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { problemId, source, input, expectedOutput, language } = parsed.data;

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
      language: language ?? "cpp",
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
    if (language && language !== problem.language) {
      return NextResponse.json({ error: "language must match the library problem" }, { status: 400 });
    }
  }

  let store;
  try {
    store = getStore();
  } catch {
    return NextResponse.json(
      { error: "Submission storage is unavailable. Check the production database configuration." },
      { status: 503 },
    );
  }
  const id = randomUUID();
  try {
    await store.create({ id, problemId, source });
  } catch {
    return NextResponse.json(
      { error: "Submission could not be saved. Retry when storage is available." },
      { status: 503 },
    );
  }

  // fire-and-forget: the execution node calls back with the result
  const dispatch = await dispatchExecution(id, problem, source, language);
  if (!dispatch.ok) {
    await store.fail(id, dispatch.error ?? "dispatch failed");
    return NextResponse.json({ id, status: "failed", error: dispatch.error }, { status: 502 });
  }

  return NextResponse.json({ id, status: "queued" }, { status: 202 });
}
