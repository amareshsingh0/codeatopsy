import { pgSchema, text, timestamp, jsonb, integer, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ExecutionResult, JobRequest } from "@codeautopsy/schemas";

const application = pgSchema("codeautopsy");

export const submissions = application.table("submissions", {
  id: text("id").primaryKey(),
  problemId: text("problem_id").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull().default("queued"),
  result: jsonb("result").$type<ExecutionResult | null>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type SubmissionRow = typeof submissions.$inferSelect;

// Keep the schema catalog consistent with the deployment SQL migration.
export const executionJobs = application.table(
  "execution_jobs",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    payload: jsonb("payload").$type<JobRequest>().notNull(),
    status: text("status").notNull().default("queued"),
    result: jsonb("result").$type<ExecutionResult | null>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "execution_jobs_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed')`,
    ),
    index("execution_jobs_claim_idx")
      .on(table.createdAt)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("execution_jobs_expiry_idx")
      .on(table.leaseUntil)
      .where(sql`${table.status} = 'running'`),
    index("execution_jobs_retention_idx")
      .on(table.completedAt)
      .where(sql`${table.completedAt} is not null`),
  ],
);
