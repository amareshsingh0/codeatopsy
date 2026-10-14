import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { JobRequest, ExecutionResult } from "@codeautopsy/schemas";
import type { JobStatus } from "@codeautopsy/schemas";

export interface DurableJob {
  jobId: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  result?: ExecutionResult;
  error?: string;
}
export interface JobLease {
  jobId: string;
  token: string;
  request: JobRequest;
}
export class QueueCapacityError extends Error {}
export class JobConflictError extends Error {}
type Row = {
  id: string;
  status: JobStatus;
  created_at: Date;
  completed_at: Date | null;
  result: unknown;
  error: string | null;
  fingerprint: string;
  payload: unknown;
  lease_token: string;
};
const toJob = (row: Row): DurableJob => ({
  jobId: row.id,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  ...(row.result ? { result: ExecutionResult.parse(row.result) } : {}),
  ...(row.error ? { error: row.error } : {}),
});

/** Shared durable queue. Claims use short row-lock transactions, then token-fenced leases. */
export class PostgresJobQueue {
  readonly kind = "postgres";
  constructor(
    private readonly sql: postgres.Sql,
    private readonly capacity = 100,
    private readonly leaseSeconds = 60,
    private readonly maxAttempts = 3,
  ) {}
  static connect(url: string, capacity = 100) {
    return new PostgresJobQueue(postgres(url, { prepare: false, max: 4, connect_timeout: 10 }), capacity);
  }
  async assertReady() {
    const [row] = await this.sql`select current_setting('server_encoding') as encoding`;
    if (row.encoding !== "UTF8")
      throw new Error("Execution database must use UTF8 encoding to preserve source and diagnostic text");
    await this.stats();
  }
  async enqueue(request: JobRequest): Promise<DurableJob> {
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    return this.sql.begin(async (tx) => {
      // Admission lock serializes capacity checks across API replicas; execution claims stay independent.
      await tx`select pg_advisory_xact_lock(192837465)`;
      const existing = await tx<Row[]>`select * from execution_jobs where id = ${request.jobId}`;
      if (existing[0]) {
        if (existing[0].fingerprint !== fingerprint)
          throw new JobConflictError("Job ID already belongs to a different submission");
        return toJob(existing[0]);
      }
      const [count] =
        await tx`select count(*)::int as count from execution_jobs where status in ('queued', 'running')`;
      if (count.count >= this.capacity) throw new QueueCapacityError("Execution queue is full. Retry later.");
      const rows = await tx<
        Row[]
      >`insert into execution_jobs (id, fingerprint, payload) values (${request.jobId}, ${fingerprint}, ${tx.json(request as unknown as postgres.JSONValue)}) returning *`;
      return toJob(rows[0]);
    }) as Promise<DurableJob>;
  }
  async get(id: string): Promise<DurableJob | null> {
    const rows = await this.sql<Row[]>`select * from execution_jobs where id = ${id}`;
    return rows[0] ? toJob(rows[0]) : null;
  }
  async claim(): Promise<JobLease | null> {
    await this
      .sql`update execution_jobs set status = 'failed', error = 'Execution worker repeatedly stopped before completion. Submit again.', completed_at = now(), lease_token = null, lease_until = null where status = 'running' and lease_until < now() and attempts >= ${this.maxAttempts}`;
    const token = randomUUID();
    const rows = await this.sql<Row[]>`
      with candidate as (
        select id from execution_jobs
        where (status = 'queued' or (status = 'running' and lease_until < now())) and attempts < ${this.maxAttempts}
        order by created_at for update skip locked limit 1
      )
      update execution_jobs j set status = 'running', lease_token = ${token}, lease_until = now() + ${this.leaseSeconds} * interval '1 second', attempts = attempts + 1
      from candidate where j.id = candidate.id returning j.*`;
    return rows[0] ? { jobId: rows[0].id, token, request: JobRequest.parse(rows[0].payload) } : null;
  }
  async renew(lease: JobLease): Promise<boolean> {
    const rows = await this
      .sql`update execution_jobs set lease_until = now() + ${this.leaseSeconds} * interval '1 second' where id = ${lease.jobId} and lease_token = ${lease.token} and status = 'running' and lease_until > now() returning id`;
    return rows.length === 1;
  }
  async finish(lease: JobLease, result: ExecutionResult | null, error?: string): Promise<boolean> {
    const rows = await this
      .sql`update execution_jobs set status = ${error ? "failed" : "completed"}, result = ${result ? this.sql.json(result as unknown as postgres.JSONValue) : null}, error = ${error ?? null}, completed_at = now(), lease_token = null, lease_until = null where id = ${lease.jobId} and lease_token = ${lease.token} and status = 'running' and lease_until > now() returning id`;
    return rows.length === 1;
  }
  async stats() {
    const rows = await this
      .sql`select status, count(*)::int as count from execution_jobs where status in ('queued', 'running') group by status`;
    return {
      active: Number(rows.find((row) => row.status === "running")?.count ?? 0),
      queued: Number(rows.find((row) => row.status === "queued")?.count ?? 0),
      capacity: this.capacity,
    };
  }
  async prune(ageSeconds = 3600) {
    await this
      .sql`delete from execution_jobs where completed_at < now() - ${ageSeconds} * interval '1 second'`;
  }
  async close() {
    await this.sql.end({ timeout: 5 });
  }
}
