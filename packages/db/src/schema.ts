import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { ExecutionResult } from "@codeautopsy/schemas";

export const submissions = pgTable("submissions", {
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
