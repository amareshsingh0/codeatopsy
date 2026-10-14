import { randomUUID, createHash } from "node:crypto";
import type { ExecutionResult, JobRequest } from "@codeautopsy/schemas";
import { processJob } from "./pipeline";

export interface JobRecord {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  result?: ExecutionResult;
  error?: string;
}
export class QueueFullError extends Error {}
export class DuplicateJobError extends Error {}

function setting(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be between 1 and ${max}`);
  return value;
}
const concurrency = setting("AUTOPSY_CONCURRENCY", 1, 16);
const capacity = setting("AUTOPSY_MAX_JOBS", 100, 1000);
const jobs = new Map<string, JobRecord>();
const payloads = new Map<string, JobRequest>();
const fingerprints = new Map<string, string>();
const queue: string[] = [];
let active = 0;

export function enqueueJob(req: JobRequest): JobRecord {
  const fingerprint = createHash("sha256").update(JSON.stringify(req)).digest("hex");
  const existing = jobs.get(req.jobId);
  if (existing) {
    if (fingerprints.get(req.jobId) !== fingerprint)
      throw new DuplicateJobError("Job ID already belongs to a different submission");
    return existing;
  }
  pruneJobs();
  if (jobs.size >= capacity) {
    const oldest = [...jobs.values()].find((r) => r.status === "completed" || r.status === "failed");
    if (oldest) {
      jobs.delete(oldest.jobId);
      fingerprints.delete(oldest.jobId);
    }
  }
  if (jobs.size >= capacity) throw new QueueFullError("Execution queue is full. Retry later.");
  const rec: JobRecord = { jobId: req.jobId, status: "queued", createdAt: new Date().toISOString() };
  jobs.set(req.jobId, rec);
  fingerprints.set(req.jobId, fingerprint);
  payloads.set(req.jobId, req);
  queue.push(req.jobId);
  setImmediate(pump);
  return rec;
}
export function getJob(id: string): JobRecord | null {
  return jobs.get(id) ?? null;
}
export function queueStats() {
  return { active, queued: queue.length, capacity, concurrency };
}

function pump(): void {
  while (active < concurrency && queue.length) {
    const id = queue.shift()!;
    const req = payloads.get(id)!;
    const rec = jobs.get(id)!;
    active++;
    rec.status = "running";
    void processJob(req)
      .then((result) => {
        rec.status = "completed";
        rec.result = result;
      })
      .catch((err) => {
        rec.status = "failed";
        rec.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        rec.completedAt = new Date().toISOString();
        active--;
        payloads.delete(id);
        void deliver(rec);
        pump();
      });
  }
}
export function pruneJobs(maxAgeMs = 60 * 60 * 1000): void {
  for (const [id, rec] of jobs) {
    if (rec.completedAt && Date.parse(rec.completedAt) < Date.now() - maxAgeMs) {
      jobs.delete(id);
      fingerprints.delete(id);
    }
  }
}
export async function deliver(rec: JobRecord): Promise<void> {
  const url = process.env.AUTOPSY_CALLBACK_URL;
  if (!url) return;
  const secret = process.env.AUTOPSY_NODE_SECRET;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret ? { "x-autopsy-secret": secret } : {}) },
        body: JSON.stringify({
          submissionId: rec.jobId,
          status: rec.status,
          result: rec.result,
          error: rec.error,
        }),
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      if (response.ok) return;
      if (response.status >= 400 && response.status < 500) break;
    } catch {
      /* bounded retries; web polling independently recovers results */
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  console.error(`[jobs] callback delivery failed for ${rec.jobId}; result remains available through polling`);
}
export function newId(): string {
  return randomUUID();
}
