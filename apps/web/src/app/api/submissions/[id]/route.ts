import { NextResponse } from "next/server";
import { getStore, getSandboxJobs } from "@codeautopsy/db";
import { pollExecution } from "@/lib/dispatch";
import { configurationIssue } from "@/lib/readiness";
import { protectedSubmissions, submissionSession } from "@/lib/submission-access";
export const maxDuration = 90;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const issue = configurationIssue();
  if (issue) return NextResponse.json({ error: issue }, { status: 503 });
  const { id } = await params;
  let store;
  let submission;
  try {
    if (protectedSubmissions()) {
      const session = submissionSession(_req);
      if (!session.valid || !(await getSandboxJobs().owns(id, session.ownerHash)))
        return NextResponse.json({ error: "unknown submission" }, { status: 404 });
    }
    store = getStore();
    submission = await store.get(id);
  } catch {
    return NextResponse.json({ error: "Submission storage is temporarily unavailable." }, { status: 503 });
  }
  if (!submission) {
    return NextResponse.json({ error: "unknown submission" }, { status: 404 });
  }
  if (submission.status !== "completed" && submission.status !== "failed") {
    try {
      const job = await pollExecution(id);
      if (!job) {
        await store.fail(id, "Execution job was lost or expired. Submit the code again.");
      } else if (job.status === "completed") {
        if (job.result) await store.complete(id, job.result);
        else await store.fail(id, "Execution node completed without a result.");
      } else if (job.status === "failed") {
        await store.fail(id, job.error ?? "execution failed");
      } else if (job.status === "running") {
        await store.setStatus(id, "running");
      }
    } catch {
      // A temporary network outage must not overwrite a completed callback.
      return NextResponse.json(
        { error: "Execution node is temporarily unavailable. Retry shortly." },
        { status: 503 },
      );
    }
    submission = await store.get(id);
  }
  return NextResponse.json(submission, { headers: { "Cache-Control": "no-store" } });
}
