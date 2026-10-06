/**
 * Submission persistence.
 *
 * Two interchangeable stores:
 *  - PgStore   — Drizzle + Postgres (Supabase in production; DATABASE_URL set)
 *  - FileStore — JSON file under .data/ (zero-config local dev, tests)
 * `getStore()` picks based on DATABASE_URL so the app is fully functional
 * with no infrastructure at all.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc } from "drizzle-orm";
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
    const rows = await this.db
      .select()
      .from(submissions)
      .orderBy(desc(submissions.createdAt))
      .limit(limit);
    return rows.map(rowToSubmission);
  }

  async setStatus(id: string, status: SubmissionStatus): Promise<void> {
    await this.db.update(submissions).set({ status }).where(eq(submissions.id, id));
  }

  async complete(id: string, result: ExecutionResult): Promise<void> {
    await this.db
      .update(submissions)
      .set({ status: "completed", result, completedAt: new Date() })
      .where(eq(submissions.id, id));
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
      .where(eq(submissions.id, id));
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

/* -------------------------------- File -------------------------------- */

class FileStore implements SubmissionStore {
  readonly kind = "file" as const;
  private readonly data: Map<string, Submission>;
  private readonly path: string;

  constructor(path = join(process.cwd(), ".data", "submissions.json")) {
    this.path = path;
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // read-only FS — fall back to memory-only
    }
    this.data = new Map();
    if (existsSync(path)) {
      try {
        for (const s of JSON.parse(readFileSync(path, "utf8")) as Submission[]) {
          this.data.set(s.id, s);
        }
      } catch {
        // corrupted store — start fresh rather than crash
      }
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.path, JSON.stringify([...this.data.values()], null, 2));
    } catch {
      // in-memory fallback on write failure
    }
  }

  async create(input: { id: string; problemId: string; source: string }): Promise<void> {
    this.data.set(input.id, {
      id: input.id,
      problemId: input.problemId,
      source: input.source,
      status: "queued",
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
    });
    this.persist();
  }

  async get(id: string): Promise<Submission | null> {
    return this.data.get(id) ?? null;
  }

  async list(limit = 20): Promise<Submission[]> {
    return [...this.data.values()].slice(-limit).reverse();
  }

  async setStatus(id: string, status: SubmissionStatus): Promise<void> {
    const s = this.data.get(id);
    if (s) {
      s.status = status;
      this.persist();
    }
  }

  async complete(id: string, result: ExecutionResult): Promise<void> {
    const s = this.data.get(id);
    if (s) {
      s.status = "completed";
      s.result = result;
      s.completedAt = new Date().toISOString();
      this.persist();
    }
  }

  async fail(id: string, error: string): Promise<void> {
    const s = this.data.get(id);
    if (s) {
      s.status = "failed";
      s.result = emptyFailure(error);
      s.completedAt = new Date().toISOString();
      this.persist();
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
    try {
      const sql = postgres(url, { prepare: false, max: 5 });
      const db = drizzle(sql);
      cached = new PgStore(db, sql);
      return cached;
    } catch (err) {
      console.warn("[db] DATABASE_URL set but Postgres unavailable; using file store:", err);
    }
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
