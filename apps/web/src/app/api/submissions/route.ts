import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getStore, getSandboxJobs, AdmissionLimit } from "@codeautopsy/db";
import { Problem, JobRequest, SubmissionRequest } from "@codeautopsy/schemas";
import { getFullProblem } from "@/lib/problems";
import { dispatchExecution } from "@/lib/dispatch";
import { configurationIssue } from "@/lib/readiness";
import { protectedSubmissions, submissionSession } from "@/lib/submission-access";
export const maxDuration = 90;

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
      ...(protectedSubmissions() ? { memoryLimitMb: 2048 } : {}),
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
  const session = protectedSubmissions() ? submissionSession(req) : null;
  try {
    if (session)
      await getSandboxJobs().reserve(
        JobRequest.parse({
          jobId: id,
          problem,
          source,
          ...(language ? { language } : {}),
          autopsy: true,
        }),
        problemId,
        session.ownerHash,
        session.addressHash,
      );
    else await store.create({ id, problemId, source });
  } catch (error) {
    if (error instanceof AdmissionLimit)
      return NextResponse.json({ error: error.message }, { status: 429, headers: { "Retry-After": "300" } });
    return NextResponse.json(
      { error: "Submission could not be saved. Retry when storage is available." },
      { status: 503 },
    );
  }

  // The provider starts durable execution; polling independently recovers results.
  const dispatch = await dispatchExecution(id, problem, source, language);
  if (!dispatch.ok) {
    await store.fail(id, dispatch.error ?? "dispatch failed");
    return NextResponse.json({ id, status: "failed", error: dispatch.error }, { status: 502 });
  }

  return NextResponse.json(
    { id, status: "queued" },
    {
      status: 202,
      headers: session ? { "Set-Cookie": session.cookie } : {},
    },
  );
}
