import {
  PostgresJobQueue,
  QueueCapacityError,
  JobConflictError,
  type DurableJob,
  type JobLease,
} from "@codeautopsy/db";
import type { JobRequest } from "@codeautopsy/schemas";
import { enqueueJob, getJob, queueStats, deliver, QueueFullError, DuplicateJobError } from "./jobs";
import { processJob } from "./pipeline";

export interface JobService {
  kind: string;
  enqueue(request: JobRequest): Promise<DurableJob>;
  get(id: string): Promise<DurableJob | null>;
  stats(): Promise<{ active: number; queued: number; capacity: number; concurrency: number }>;
  start(): Promise<void>;
  close(): Promise<void>;
}
function positiveSetting(name: string, fallback: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be between 1 and ${max}`);
  return value;
}
export function createJobService(): JobService {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Production workers require DATABASE_URL and the durable queue migration");
    return {
      kind: "memory",
      async enqueue(request) {
        return enqueueJob(request);
      },
      async get(id) {
        return getJob(id);
      },
      async stats() {
        return queueStats();
      },
      async start() {},
      async close() {},
    };
  }
  const queue = PostgresJobQueue.connect(url, positiveSetting("AUTOPSY_MAX_JOBS", 100, 1000));
  const concurrency = positiveSetting("AUTOPSY_CONCURRENCY", 1, 16);
  let closing = false;
  let pumping = false;
  let timer: NodeJS.Timeout | undefined;
  let retention: NodeJS.Timeout | undefined;
  let active = 0;
  const pending = new Set<Promise<void>>();
  const execute = async (lease: JobLease) => {
    let owned = true;
    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy || !owned) return;
      heartbeatBusy = true;
      try {
        owned = await queue.renew(lease);
      } catch {
        console.error(`[queue] heartbeat failed for ${lease.jobId}`);
      } finally {
        heartbeatBusy = false;
      }
    }, 15000);
    try {
      const result = await processJob(lease.request);
      if (owned && (await queue.finish(lease, result))) {
        const rec = await queue.get(lease.jobId);
        if (rec) void deliver(rec);
      }
    } catch (error) {
      console.error(
        `[queue] job ${lease.jobId} failed: ${error instanceof Error ? error.name + ": " + error.message : "unknown error"}`,
      );
      if (
        owned &&
        (await queue.finish(lease, null, "Execution failed. Retry the submission or inspect worker logs."))
      ) {
        const rec = await queue.get(lease.jobId);
        if (rec) void deliver(rec);
      }
    } finally {
      clearInterval(heartbeat);
      active--;
    }
  };
  const pump = async () => {
    if (pumping || closing) return;
    pumping = true;
    try {
      while (active < concurrency && !closing) {
        const lease = await queue.claim();
        if (!lease) break;
        active++;
        const task = execute(lease).catch(() =>
          console.error(`[queue] result persistence failed for ${lease.jobId}; lease recovery will retry`),
        );
        pending.add(task);
        void task.finally(() => pending.delete(task));
      }
    } catch {
      console.error("[queue] claim failed; retrying without discarding pending jobs");
    } finally {
      pumping = false;
    }
  };
  return {
    kind: queue.kind,
    async enqueue(request) {
      try {
        return await queue.enqueue(request);
      } catch (error) {
        if (error instanceof QueueCapacityError) throw new QueueFullError(error.message);
        if (error instanceof JobConflictError) throw new DuplicateJobError(error.message);
        throw error;
      }
    },
    get: (id) => queue.get(id),
    async stats() {
      return { ...(await queue.stats()), concurrency };
    },
    async start() {
      await queue.assertReady();
      timer = setInterval(() => {
        void pump();
      }, 750);
      timer.unref();
      retention = setInterval(() => {
        void queue.prune().catch(() => console.error("[queue] retention cleanup failed"));
      }, 600000);
      retention.unref();
      void pump();
    },
    async close() {
      closing = true;
      clearInterval(timer);
      clearInterval(retention);
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise((resolve) => {
          const timeout = setTimeout(resolve, 5000);
          timeout.unref();
        }),
      ]);
      await queue.close();
    },
  };
}
