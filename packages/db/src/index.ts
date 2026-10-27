/**
 * Submission persistence.
 *
 * Two interchangeable stores:
 *  - PgStore   — Drizzle + Postgres (Supabase in production; DATABASE_URL set)
 *  - FileStore — JSON file under .data/ (zero-config local dev, tests)
 * `getStore()` picks based on DATABASE_URL so the app is fully functional
 * with no infrastructure at all.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc, and, inArray } from "drizzle-orm";
import { Submission as SubmissionSchema } from "@codeautopsy/schemas";
import type { ExecutionResult, Submission, SubmissionStatus } from "@codeautopsy/schemas";
import { submissions } from "./schema";

export interface SubmissionStore {
  readonly kind: "postgres" | "file";
  create(input: { id: string; problemId: string; source: string }): Promise<void>;
  get(id: string): Promise<Submission | null>;
  list(limit?: number): Promise<Submission[]>;
  setStatus(id: string, status: SubmissionStatus): Promise<void>;
  complete(id: string, result: ExecutionResult): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  close(): Promise<void>;
}

function rowToSubmission(row: {
  id: string;
  problemId: string;
  source: string;
  status: string;
  result: ExecutionResult | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): Submission {
  return {
    id: row.id,
    problemId: row.problemId,
    source: row.source,
    status: row.status as SubmissionStatus,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    result: row.result,
  };
}

/* ------------------------------ Postgres ------------------------------ */

class PgStore implements SubmissionStore {
  readonly kind = "postgres" as const;

  constructor(
    private readonly db: ReturnType<typeof drizzle>,
    private readonly sql: postgres.Sql,
  ) {}

  async create(input: { id: string; problemId: string; source: string }): Promise<void> {
    await this.db.insert(submissions).values({
      id: input.id,
      problemId: input.problemId,
      source: input.source,
      status: "queued",
    });
  }

  async get(id: string): Promise<Submission | null> {
    const rows = await this.db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
    return rows[0] ? rowToSubmission(rows[0]) : null;
  }

  async list(limit = 20): Promise<Submission[]> {
    const rows = await this.db.select().from(submissions).orderBy(desc(submissions.createdAt)).limit(limit);
    return rows.map(rowToSubmission);
  }

  async setStatus(id: string, status: SubmissionStatus): Promise<void> {
    await this.db
      .update(submissions)
      .set({ status })
      .where(
        and(
          eq(submissions.id, id),
          inArray(submissions.status, ["queued", "compiling", "running", "analyzing"]),
        ),
      );
  }

  async complete(id: string, result: ExecutionResult): Promise<void> {
    await this.db
      .update(submissions)
      .set({ status: "completed", result, completedAt: new Date() })
      .where(
        and(
          eq(submissions.id, id),
          inArray(submissions.status, ["queued", "compiling", "running", "analyzing"]),
        ),
      );
  }

  async fail(id: string, error: string): Promise<void> {
    await this.db
      .update(submissions)
      .set({
        status: "failed",
        error,
        result: emptyFailure(error),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(submissions.id, id),
          inArray(submissions.status, ["queued", "compiling", "running", "analyzing"]),
        ),
      );
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

/* -------------------------------- File -------------------------------- */

class FileStore implements SubmissionStore {
  readonly kind = "file" as const;
  private readonly recordsDir: string;

  constructor(path = join(process.cwd(), ".data", "submissions.json")) {
    this.recordsDir = `${path}.d`;
    mkdirSync(this.recordsDir, { recursive: true });
    if (existsSync(/* turbopackIgnore: true */ path)) {
      // Preserve existing installations. Corruption is surfaced, never erased.
      for (const item of JSON.parse(readFileSync(/* turbopackIgnore: true */ path, "utf8")) as unknown[]) {
        const s = SubmissionSchema.parse(item);
        if (!existsSync(this.recordPath(s.id))) this.persist(s);
      }
    }
  }

  private recordPath(id: string): string {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid submission ID");
    return join(this.recordsDir, `${id}.json`);
  }

  private read(id: string): Submission | null {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
    const path = this.recordPath(id);
    if (!existsSync(path)) return null;
    return SubmissionSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  }

  private persist(submission: Submission): void {
    const path = this.recordPath(submission.id);
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(submission), { flag: "wx" });
      renameSync(temp, path);
    } finally {
      rmSync(temp, { force: true });
    }
  }

  async create(input: { id: string; problemId: string; source: string }): Promise<void> {
    if (this.read(input.id)) throw new Error("Submission already exists");
    this.persist({
      id: input.id,
      problemId: input.problemId,
      source: input.source,
      status: "queued",
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
    });
  }

  async get(id: string): Promise<Submission | null> {
    return this.read(id);
  }

  async list(limit = 20): Promise<Submission[]> {
    if (!Number.isInteger(limit) || limit < 1) return [];
    return readdirSync(this.recordsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.read(name.slice(0, -5))!)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async setStatus(id: string, status: SubmissionStatus): Promise<void> {
    const s = this.read(id);
    if (s && s.status !== "completed" && s.status !== "failed") {
      s.status = status;
      this.persist(s);
    }
  }

  async complete(id: string, result: ExecutionResult): Promise<void> {
    const s = this.read(id);
    if (s && s.status !== "completed" && s.status !== "failed") {
      s.status = "completed";
      s.result = result;
      s.completedAt = new Date().toISOString();
      this.persist(s);
    }
  }

  async fail(id: string, error: string): Promise<void> {
    const s = this.read(id);
    if (s && s.status !== "completed" && s.status !== "failed") {
      s.status = "failed";
      s.result = emptyFailure(error);
      s.completedAt = new Date().toISOString();
      this.persist(s);
    }
  }

  async close(): Promise<void> {}
}

/* ------------------------------ selection ----------------------------- */

let cached: SubmissionStore | null = null;

export function getStore(): SubmissionStore {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (url && /^postgres/.test(url)) {
    const sql = postgres(url, { prepare: false, max: 5, connect_timeout: 10 });
    const db = drizzle(sql);
    cached = new PgStore(db, sql);
    return cached;
  }
  if (url) throw new Error("DATABASE_URL must be a Postgres URL");
  if (process.env.NODE_ENV === "production" && process.env.AUTOPSY_ALLOW_FILE_STORE !== "true") {
    throw new Error(
      "Production persistence requires DATABASE_URL, or explicit AUTOPSY_ALLOW_FILE_STORE=true on a persistent filesystem",
    );
  }
  cached = new FileStore();
  return cached;
}

export function emptyFailure(error: string): ExecutionResult {
  return {
    ok: false,
    compileError: null,
    verdicts: [],
    studentTraces: {},
    referenceTraces: {},
    report: null,
    error,
  };
}

export { FileStore, PgStore };
export { PostgresJobQueue, QueueCapacityError, JobConflictError } from "./job-queue";
export type { DurableJob, JobLease } from "./job-queue";
export { SandboxJobs, getSandboxJobs, AdmissionLimit } from "./sandbox-jobs";
export { applyPrivateMigration } from "./migrate";
