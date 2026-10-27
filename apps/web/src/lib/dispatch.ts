import "server-only";
import {
  ExecutionResult,
  JobRequest,
  Language,
  JobStatus,
  type SubmissionStatus,
} from "@codeautopsy/schemas";
import type { Problem } from "@codeautopsy/schemas";
import { executionProvider, publicExecutionError } from "./execution-provider";

export const EXECUTION_NODE_URL = process.env.EXECUTION_NODE_URL ?? "http://127.0.0.1:8787";
const SECRET = process.env.AUTOPSY_NODE_SECRET;

/** Polling is also the recovery path when a callback is absent or lost. */
export async function pollExecution(jobId: string) {
  if (executionProvider() === "vercel") {
    const { pollSandboxJob } = await import("./vercel-jobs");
    return pollSandboxJob(jobId);
  }
  const res = await fetch(`${EXECUTION_NODE_URL}/jobs/${encodeURIComponent(jobId)}`, {
    headers: SECRET ? { "x-autopsy-secret": SECRET } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`execution node responded ${res.status}`);
  const body = (await res.json()) as { jobId?: unknown; status?: unknown; result?: unknown; error?: unknown };
  if (body.jobId !== jobId) throw new Error("execution node returned a different job");
  return {
    status: JobStatus.parse(body.status),
    result: body.result ? ExecutionResult.parse(body.result) : undefined,
    error: typeof body.error === "string" ? body.error : undefined,
  };
}

export async function dispatchExecution(
  jobId: string,
  problem: Problem,
  source: string,
  language?: Language,
): Promise<{ ok: boolean; error?: string }> {
  const body = JobRequest.parse({
    jobId,
    problem,
    source,
    ...(language ? { language } : {}),
    autopsy: true,
  } satisfies JobRequest);
  try {
    if (executionProvider() === "vercel") {
      const { startSandboxJob } = await import("./vercel-jobs");
      await startSandboxJob(jobId);
      return { ok: true };
    }
    const res = await fetch(`${EXECUTION_NODE_URL}/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SECRET ? { "x-autopsy-secret": SECRET } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { ok: false, error: `execution node responded ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: publicExecutionError(err),
    };
  }
}

export const STATUS_FLOW: SubmissionStatus[] = ["queued", "compiling", "running", "analyzing", "completed"];
