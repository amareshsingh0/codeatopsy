/**
 * The full autopsy pipeline for one submission:
 *   compile student + reference → verdict per test → instrument + trace both →
 *   align traces → find first divergence → explain.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  parseTraceJsonl,
  type ExecutionResult,
  type JobRequest,
  type TestVerdict,
  type Trace,
} from "@codeautopsy/schemas";
import { instrument, runtimeHeaderPath } from "@codeautopsy/instrumenter";
import { alignTraces } from "@codeautopsy/trace-core";
import { buildReport } from "@codeautopsy/explanation";
import type { Sandbox } from "./sandbox";
import { createSandbox } from "./sandbox";

function normalizeOutput(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trimEnd())
    .join("\n")
    .trimEnd();
}

function firstMismatch(actual: string, expected: string): string | undefined {
  const a = normalizeOutput(actual).split("\n");
  const b = normalizeOutput(expected).split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: expected "${b[i] ?? "<missing>"}", got "${a[i] ?? "<missing>"}"`;
    }
  }
  return undefined;
}

const TRACE_PROBE_FLAGS = ["-O0", "-include", runtimeHeaderPath, "-DAUTOPSY=1"];

export async function processJob(job: JobRequest): Promise<ExecutionResult> {
  const sandbox = createSandbox();
  try {
    return await runPipeline(job, sandbox);
  } finally {
    sandbox.cleanup();
  }
}

async function runPipeline(job: JobRequest, sandbox: Sandbox): Promise<ExecutionResult> {
  const problem = job.problem;
  const result: ExecutionResult = {
    ok: false,
    compileError: null,
    verdicts: [],
    studentTraces: {},
    referenceTraces: {},
    report: null,
  };

  // ---- compile vanilla binaries (verdicts) ----
  const hasReference = problem.referenceSource.trim().length > 0;
  const studentBin = `student_${job.jobId}`;
  const refBin = `reference_${job.jobId}`;
  const studentCompile = await sandbox.compile("student", job.source, [], studentBin);
  if (!studentCompile.ok) {
    result.compileError = { side: "student", stderr: studentCompile.stderr.slice(-4000) };
    result.report = (
      await buildReport(result, undefined, undefined, null, problem.bugHint)
    ).report;
    return result;
  }
  let refCompile: Awaited<ReturnType<typeof sandbox.compile>> | null = null;
  if (hasReference) {
    refCompile = await sandbox.compile("reference", problem.referenceSource, [], refBin);
    if (!refCompile.ok) {
      result.compileError = { side: "reference", stderr: refCompile.stderr.slice(-4000) };
      result.report = (
        await buildReport(result, undefined, undefined, null, problem.bugHint)
      ).report;
      return result;
    }
  }

  // ---- verdict runs ----
  for (const test of problem.tests) {
    const run = await sandbox.run(studentBin, {
      input: test.input,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    });
    let status: TestVerdict["status"];
    let detail: string | undefined;
    if (run.timedOut) {
      status = "timeout";
    } else if (run.exitCode !== 0) {
      status = "runtime_error";
      detail = run.stderr.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300) || `exit code ${run.exitCode}`;
    } else if (test.expectedOutput.trim() === "") {
      // playground mode: no expected output — running cleanly is the pass condition
      status = "accepted";
    } else if (normalizeOutput(run.stdout) !== normalizeOutput(test.expectedOutput)) {
      status = "wrong_answer";
      detail = firstMismatch(run.stdout, test.expectedOutput);
    } else {
      status = "accepted";
    }
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      durationMs: run.durationMs,
    });
  }

  // ---- autopsy mode: instrument, compile, trace (reference only when present) ----
  const failedVerdicts = result.verdicts.filter((v) => v.status !== "accepted");
  if (job.autopsy && (failedVerdicts.length > 0 || !hasReference)) {
    try {
      const studentInst = instrument(job.source);
      const refInst = hasReference ? instrument(problem.referenceSource) : null;
      const studentTraceBin = `student_traced_${job.jobId}`;
      const refTraceBin = `reference_traced_${job.jobId}`;

      const stc = await sandbox.compile("student", studentInst.code, TRACE_PROBE_FLAGS, studentTraceBin);
      const rtc =
        refInst !== null
          ? await sandbox.compile("reference", refInst.code, TRACE_PROBE_FLAGS, refTraceBin)
          : null;

      if (stc.ok && (rtc === null || rtc.ok)) {
        for (const test of problem.tests) {
          const verdict = result.verdicts.find((v) => v.testId === test.id)!;
          // skip tracing tests that will never terminate
          if (verdict.status === "timeout") continue;

          const studentTrace = await traceRun(
            sandbox,
            studentTraceBin,
            test.input,
            test.id,
            "student",
            problem,
          );
          if (studentTrace && studentTrace.events.length > 0) result.studentTraces[test.id] = studentTrace;
          if (refInst !== null && rtc !== null) {
            const refTrace = await traceRun(
              sandbox,
              refTraceBin,
              test.input,
              test.id,
              "reference",
              problem,
            );
            if (refTrace && refTrace.events.length > 0) result.referenceTraces[test.id] = refTrace;
          }
        }
      }
    } catch (err) {
      // instrumentation is best-effort — the verdicts still stand
      console.error("[pipeline] autopsy stage failed:", err);
    }
  }

  // ---- analysis ----
  let divergence = null as ReturnType<typeof alignTraces>["divergence"];
  let studentTrace: Trace | undefined;
  let referenceTrace: Trace | undefined;
  const firstFailed = result.verdicts.find((v) => v.status !== "accepted");
  if (firstFailed) {
    studentTrace = result.studentTraces[firstFailed.testId];
    referenceTrace = result.referenceTraces[firstFailed.testId];
    if (studentTrace && referenceTrace) {
      divergence = alignTraces(studentTrace, referenceTrace, firstFailed.testId).divergence;
    }
  }

  const { report } = await buildReport(result, studentTrace, referenceTrace, divergence, problem.bugHint);
  result.report = report;
  result.referenceSource = problem.referenceSource;
  result.ok = true;
  return result;
}

async function traceRun(
  sandbox: Sandbox,
  exeName: string,
  input: string,
  testId: string,
  side: "student" | "reference",
  problem: JobRequest["problem"],
): Promise<Trace | null> {
  const traceFile = `trace_${side}_${testId}.jsonl`;
  const timeBudget = Math.max(500, problem.timeLimitMs - 400);
  const run = await sandbox.run(exeName, {
    input,
    timeLimitMs: problem.timeLimitMs + 1000, // instrumented code is slower
    memoryLimitMb: problem.memoryLimitMb,
    env: {
      AUTOPSY_TRACE_PATH: join(workdirOf(sandbox), traceFile),
      AUTOPSY_MAX_EVENTS: "200000",
      AUTOPSY_TIME_BUDGET_MS: String(timeBudget),
    },
  });
  if (run.timedOut) return null;
  try {
    const raw = readFileSync(join(workdirOf(sandbox), traceFile), "utf8");
    let truncated = false;
    const lines = raw.split("\n");
    const filtered: string[] = [];
    for (const l of lines) {
      const t = l.trim();
      if (!t) continue;
      if (t.includes("_autopsy_truncated")) {
        try {
          truncated = (JSON.parse(t) as { _autopsy_truncated?: boolean })._autopsy_truncated === true;
        } catch {
          /* ignore malformed trailer */
        }
        continue;
      }
      filtered.push(t);
    }
    const { trace } = parseTraceJsonl(filtered.join("\n"), {
      problemId: problem.slug,
      testId,
      side,
      exitCode: run.exitCode ?? 0,
      durationMs: run.durationMs,
      truncated,
    });
    return trace;
  } catch {
    return null;
  }
}

function workdirOf(sandbox: Sandbox): string {
  // both sandboxes keep files in their private workdir
  return (sandbox as unknown as { dir: string }).dir;
}

export { normalizeOutput, firstMismatch };
