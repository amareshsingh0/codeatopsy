import "server-only";
import { JobRequest, Language, type SubmissionStatus } from "@codeautopsy/schemas";
import type { Problem } from "@codeautopsy/schemas";

export const EXECUTION_NODE_URL =
  process.env.EXECUTION_NODE_URL ?? "http://127.0.0.1:8787";
const SECRET = process.env.AUTOPSY_NODE_SECRET;

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
      error: `cannot reach execution node at ${EXECUTION_NODE_URL} — is it running? (${err instanceof Error ? err.message : err})`,
    };
  }
}

export const STATUS_FLOW: SubmissionStatus[] = [
  "queued",
  "compiling",
  "running",
  "analyzing",
  "completed",
];
