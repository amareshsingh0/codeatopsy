import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { ExecutionResult, JobRequest, type ExecutionResult as Result } from "@codeautopsy/schemas";

export class AdmissionLimit extends Error {}
export interface SandboxRun {
  job_id: string;
  payload: JobRequest | null;
  state: "queued" | "starting" | "running" | "completed" | "failed";
  sandbox_name: string;
  launch_token: string | null;
  launch_until: Date | null;
  deadline_at: Date | null;
  result: Result | null;
  error: string | null;
}

export class SandboxJobs {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly schema = "codeautopsy",
  ) {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Invalid job schema");
  }
  async assertReady() {
    const [row] = await this.sql`select current_setting('server_encoding') as encoding`;
    if (row.encoding !== "UTF8") throw new Error("Database must use UTF8");
    await this.sql`select job_id from ${this.sql(this.schema + ".sandbox_runs")} limit 0`;
    await this.sql`select owner_hash from ${this.sql(this.schema + ".submission_access")} limit 0`;
  }
  async reserve(job: JobRequest, problemId: string, ownerHash: string, addressHash: string) {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(192837467)`;
      const expired = await tx`update ${tx(this.schema + ".sandbox_runs")}
        set state='failed',payload=null,error='Execution expired. Submit the code again.'
        where (state in ('starting','running') and deadline_at<now())
          or (state='queued' and created_at<now()-interval '30 minutes') returning job_id`;
      for (const row of expired)
        await tx`update ${tx(this.schema + ".submissions")}
        set status='failed',completed_at=now(),error='Execution expired. Submit the code again.',
          result=${tx.json({ ok: false, compileError: null, verdicts: [], studentTraces: {}, referenceTraces: {}, report: null, error: "Execution expired. Submit the code again." })}
        where id=${row.job_id} and status not in ('completed','failed')`;
      // The initial free deployment retains new execution records for 24 hours.
      await tx`delete from ${tx(this.schema + ".submissions")} where id in (
        select submission_id from ${tx(this.schema + ".submission_access")}
        where created_at < now() - interval '24 hours'
      ) and status in ('completed','failed')`;
      const [counts] = await tx`
        select count(*)::int as total,
          count(*) filter (where address_hash = ${addressHash} and created_at > now() - interval '1 hour')::int as hourly
        from ${tx(this.schema + ".submission_access")} where created_at > now() - interval '24 hours'`;
      if (counts.total >= 100 || counts.hourly >= 50)
        throw new AdmissionLimit(
          "Execution allowance reached. Try again later; the shared free deployment has daily and hourly limits.",
        );
      const [waiting] =
        await tx`select count(*)::int as count from ${tx(this.schema + ".sandbox_runs")} where state in ('queued','starting','running')`;
      if (waiting.count >= 30) throw new AdmissionLimit("The execution queue is full. Retry shortly.");
      await tx`insert into ${tx(this.schema + ".submissions")} (id,problem_id,source) values (${job.jobId},${problemId},${job.source})`;
      await tx`insert into ${tx(this.schema + ".submission_access")} (submission_id,owner_hash,address_hash) values (${job.jobId},${ownerHash},${addressHash})`;
      await tx`insert into ${tx(this.schema + ".sandbox_runs")} (job_id,payload,sandbox_name) values (${job.jobId},${tx.json(job as unknown as postgres.JSONValue)},${"ca-run-" + job.jobId})`;
    });
  }
  async owns(id: string, ownerHash: string): Promise<boolean> {
    const rows = await this
      .sql`select 1 from ${this.sql(this.schema + ".submission_access")} where submission_id=${id} and owner_hash=${ownerHash}`;
    return rows.length === 1;
  }
  async get(id: string): Promise<SandboxRun | null> {
    const rows = await this.sql<SandboxRun[]>`
      select r.*, s.result from ${this.sql(this.schema + ".sandbox_runs")} r
      join ${this.sql(this.schema + ".submissions")} s on s.id=r.job_id where r.job_id=${id}`;
    return rows[0] ?? null;
  }
  async claim(id: string): Promise<SandboxRun | null> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(192837468)`;
      const [count] = await tx`select count(*)::int as count from ${tx(this.schema + ".sandbox_runs")}
        where job_id<>${id} and state in ('starting','running') and deadline_at>now()`;
      if (count.count >= 3) return null;
      const token = randomUUID();
      const rows = await tx<SandboxRun[]>`update ${tx(this.schema + ".sandbox_runs")}
        set state='starting',launch_token=${token},launch_until=now()+interval '45 seconds',
          deadline_at=coalesce(deadline_at,now()+interval '12 minutes')
        where job_id=${id} and (state='queued' or (state='starting' and launch_until<now()))
        returning *,null::jsonb as result`;
      return rows[0] ?? null;
    }) as Promise<SandboxRun | null>;
  }
  async started(id: string, token: string) {
    await this.sql`update ${this.sql(this.schema + ".sandbox_runs")} set state='running',launch_until=null
      where job_id=${id} and state='starting' and launch_token=${token}`;
  }
  async finish(id: string, result: Result | null, error?: string) {
    if (result) ExecutionResult.parse(result);
    await this.sql.begin(async (tx) => {
      const rows = await tx`update ${tx(this.schema + ".sandbox_runs")}
        set state=${error ? "failed" : "completed"},payload=null,error=${error ?? null},launch_until=null
        where job_id=${id} and state in ('queued','starting','running') returning job_id`;
      if (!rows.length) return;
      const saved = result ?? {
        ok: false,
        compileError: null,
        verdicts: [],
        studentTraces: {},
        referenceTraces: {},
        report: null,
        error,
      };
      await tx`update ${tx(this.schema + ".submissions")} set status=${error ? "failed" : "completed"},
        result=${tx.json(saved as unknown as postgres.JSONValue)},error=${error ?? null},completed_at=now()
        where id=${id} and status not in ('completed','failed')`;
    });
  }
  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

let instance: SandboxJobs | undefined;
export function getSandboxJobs(): SandboxJobs {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url || !/^postgres(?:ql)?:\/\//.test(url)) throw new Error("Postgres database is required");
    instance = new SandboxJobs(postgres(url, { prepare: false, max: 4, connect_timeout: 10 }));
  }
  return instance;
}
