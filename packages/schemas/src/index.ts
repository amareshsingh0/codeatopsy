/**
 * @codeautopsy/schemas — single source of truth for every type that crosses a
 * package/app boundary: trace events, execution jobs, problems, verdicts and
 * autopsy reports. Everything else imports from here.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Trace events                                                        */
/* ------------------------------------------------------------------ */

export const TraceEventKind = z.enum([
  "call", // entered a function
  "assign", // variable created or value changed
  "branch", // if / while / for / switch condition evaluated
  "return", // function returned a value
  "returnvoid", // function returned without a value
  "output", // program wrote to stdout (checkpoint markers)
]);
export type TraceEventKind = z.infer<typeof TraceEventKind>;

export const TraceEvent = z.object({
  /** monotonically increasing sequence number, 0-based */
  seq: z.number().int().nonnegative(),
  kind: TraceEventKind,
  /** 1-based source line the event originates from */
  line: z.number().int().positive(),
  /** enclosing function name */
  fn: z.string().optional(),
  /** variable name (assign events) */
  name: z.string().optional(),
  /** serialized value (assign) or condition text (branch) */
  value: z.string().optional(),
  /** condition source text (branch events) */
  cond: z.string().optional(),
  /** branch outcome */
  taken: z.boolean().optional(),
  /** call-stack depth at the moment of the event */
  depth: z.number().int().nonnegative(),
});
export type TraceEvent = z.infer<typeof TraceEvent>;

export const TraceMeta = z.object({
  problemId: z.string(),
  testId: z.string(),
  /** which side produced the trace */
  side: z.enum(["student", "reference"]),
  exitCode: z.number().int(),
  durationMs: z.number().nonnegative(),
  /** runtime stopped early because an event/time budget was hit */
  truncated: z.boolean(),
});
export type TraceMeta = z.infer<typeof TraceMeta>;

export const Trace = z.object({
  meta: TraceMeta,
  events: z.array(TraceEvent),
});
export type Trace = z.infer<typeof Trace>;

/* ------------------------------------------------------------------ */
/* Problems                                                            */
/* ------------------------------------------------------------------ */

export const TestCase = z.object({
  id: z.string(),
  input: z.string(),
  expectedOutput: z.string(),
  /** hidden tests are not shown to the student until submission */
  hidden: z.boolean().default(false),
});
export type TestCase = z.infer<typeof TestCase>;

export const Problem = z.object({
  slug: z.string(),
  title: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  /** short one-liner for cards */
  blurb: z.string(),
  /** markdown statement */
  statement: z.string(),
  topics: z.array(z.string()).default([]),
  timeLimitMs: z.number().int().positive().default(5000),
  memoryLimitMb: z.number().int().positive().default(256),
  tests: z.array(TestCase).min(1),
  /** known-correct solution; server-side only, never sent to the browser */
  referenceSource: z.string(),
  /** the canonical buggy submission used for demos */
  studentSource: z.string(),
  /** hint about the injected bug, used by the explanation engine */
  bugHint: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;

/* ------------------------------------------------------------------ */
/* Verdicts & jobs                                                     */
/* ------------------------------------------------------------------ */

export const TestVerdict = z.object({
  testId: z.string(),
  status: z.enum(["accepted", "wrong_answer", "runtime_error", "timeout", "compile_error"]),
  /** exit code of the student binary */
  exitCode: z.number().int().nullable(),
  /** first line of mismatch, truncated */
  detail: z.string().optional(),
  /** actual program stdout (truncated) — shown in the playground/output panel */
  output: z.string().optional(),
  durationMs: z.number().nonnegative(),
});
export type TestVerdict = z.infer<typeof TestVerdict>;

export const JobRequest = z.object({
  jobId: z.string(),
  problem: Problem,
  /** the code being autopsied */
  source: z.string(),
  /** run the instrumentation pipeline (default true) */
  autopsy: z.boolean().default(true),
});
export type JobRequest = z.infer<typeof JobRequest>;

export const JobStatus = z.enum(["queued", "running", "completed", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const SubmissionStatus = z.enum(["queued", "compiling", "running", "analyzing", "completed", "failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

/* ------------------------------------------------------------------ */
/* Autopsy report                                                      */
/* ------------------------------------------------------------------ */

export const Hypothesis = z.object({
  id: z.string(),
  title: z.string(),
  /** 0..1 */
  confidence: z.number(),
  /** human-readable explanation of the mechanism */
  mechanism: z.string(),
  /** source lines in the student code implicated */
  lines: z.array(z.number().int()).default([]),
  /** trace evidence backing the hypothesis */
  evidence: z
    .array(
      z.object({
        description: z.string(),
        studentEventSeq: z.number().int().optional(),
        referenceEventSeq: z.number().int().optional(),
      }),
    )
    .default([]),
});
export type Hypothesis = z.infer<typeof Hypothesis>;

export const Divergence = z.object({
  /** test where the first meaningful divergence happened */
  testId: z.string(),
  /** event index in the student trace */
  studentSeq: z.number().int(),
  /** event index in the reference trace */
  referenceSeq: z.number().int(),
  /** kind of divergence */
  kind: z.enum(["value", "control", "missing", "extra"]),
  /** student-side description, e.g. `left = 5 (reference: 6)` */
  studentText: z.string(),
  referenceText: z.string(),
  studentLine: z.number().int().optional(),
  referenceLine: z.number().int().optional(),
});
export type Divergence = z.infer<typeof Divergence>;

export const AutopsyReport = z.object({
  /** one-line verdict, e.g. "Wrong answer — off-by-one in the search loop" */
  headline: z.string(),
  divergence: Divergence.nullable(),
  hypotheses: z.array(Hypothesis).default([]),
  /** markdown narrative for the report panel */
  narrative: z.string(),
  provider: z.enum(["rules", "gemini", "openrouter"]),
});
export type AutopsyReport = z.infer<typeof AutopsyReport>;

export const ExecutionResult = z.object({
  ok: z.boolean(),
  compileError: z
    .object({
      side: z.enum(["student", "reference"]),
      stderr: z.string(),
    })
    .nullable(),
  verdicts: z.array(TestVerdict),
  /** full traces, keyed by test id — only for tests that ran */
  studentTraces: z.record(z.string(), Trace),
  referenceTraces: z.record(z.string(), Trace),
  report: AutopsyReport.nullable(),
  /** the correct solution, revealed to the browser only after the run completes */
  referenceSource: z.string().optional(),
  error: z.string().optional(),
});
export type ExecutionResult = z.infer<typeof ExecutionResult>;

/* ------------------------------------------------------------------ */
/* Submission (stored)                                                 */
/* ------------------------------------------------------------------ */

export const Submission = z.object({
  id: z.string(),
  problemId: z.string(),
  source: z.string(),
  status: SubmissionStatus,
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  result: ExecutionResult.nullable(),
});
export type Submission = z.infer<typeof Submission>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Parse JSONL trace output from the C++ runtime, skipping corrupt lines. */
export function parseTraceJsonl(
  raw: string,
  meta: z.infer<typeof TraceMeta>,
): { trace: Trace; dropped: number } {
  const events: TraceEvent[] = [];
  let dropped = 0;
  let seq = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      events.push(
        TraceEvent.parse({
          seq: seq++,
          kind: parsed.k,
          line: parsed.l,
          fn: parsed.f,
          name: parsed.n,
          value: parsed.v,
          cond: parsed.c,
          taken: parsed.t,
          depth: parsed.d ?? 0,
        }),
      );
    } catch {
      dropped++;
    }
  }
  return { trace: { meta, events }, dropped };
}
