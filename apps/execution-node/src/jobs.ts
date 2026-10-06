/**
 * In-memory job registry with a serial worker. Jobs are pushed by the web API
 * and their results are delivered back via the callback URL (plus GET polling).
 */
import { randomUUID } from "node:crypto";
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

const jobs = new Map<string, JobRecord>();
const queue: string[] = [];
let running = false;
const CONCURRENCY = Number(process.env.AUTOPSY_CONCURRENCY || "1");
let active = 0;

export function enqueueJob(req: JobRequest): JobRecord {
  const existing = jobs.get(req.jobId);
  if (existing) return existing;
  const rec: JobRecord = { jobId: req.jobId, status: "queued", createdAt: new Date().toISOString() };
  jobs.set(req.jobId, rec);
  queue.push(req.jobId);
  pump();
  return rec;
}

export function getJob(id: string): JobRecord | null {
  return jobs.get(id) ?? null;
}

function pump(): void {
  if (running) return;
  running = true;
  const tick = () => {
    if (active >= CONCURRENCY || queue.length === 0) {
      running = false;
      return;
    }
    const id = queue.shift()!;
    const rec = jobs.get(id)!;
    const req = pendingRequests.get(id);
    if (!req) {
      rec.status = "failed";
      rec.error = "job payload missing";
      tick();
      return;
    }
    active++;
    rec.status = "running";
    processJob(req)
      .then((result) => {
        rec.status = "completed";
        rec.result = result;
        rec.completedAt = new Date().toISOString();
      })
      .catch((err) => {
        rec.status = "failed";
        rec.error = err instanceof Error ? err.message : String(err);
        rec.completedAt = new Date().toISOString();
      })
      .finally(() => {
        active--;
        deliver(req, rec);
        setImmediate(tick);
      });
  };
  setImmediate(tick);
}

/** callbacks: POST the finished result back to the web API */
const pendingRequests = new Map<string, JobRequest>();

export function registerPayload(req: JobRequest): void {
  pendingRequests.set(req.jobId, req);
  // payload stays for the lifetime of the job; cleaned with the job
}

export function pruneJobs(maxAgeMs = 60 * 60 * 1000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, rec] of jobs) {
    const t = Date.parse(rec.completedAt ?? rec.createdAt);
    if (rec.status !== "queued" && rec.status !== "running" && t < cutoff) {
      jobs.delete(id);
      pendingRequests.delete(id);
    }
  }
}

async function deliver(req: JobRequest, rec: JobRecord): Promise<void> {
  const url = process.env.AUTOPSY_CALLBACK_URL;
  const secret = process.env.AUTOPSY_NODE_SECRET;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-autopsy-secret": secret } : {}),
      },
      body: JSON.stringify({
        jobId: rec.jobId,
        submissionId: req.jobId, // web maps jobId → submissionId
        status: rec.status,
        result: rec.result,
        error: rec.error,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error("[jobs] callback failed:", err);
  }
}

export function newId(): string {
  return randomUUID();
}
