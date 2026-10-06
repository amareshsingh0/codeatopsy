/**
 * The full autopsy pipeline for one submission, dispatched by language:
 *   cpp/c   — g++ compile → verdicts → instrument both sides → traces → divergence
 *   python  — interpreter run → verdicts → sys.settrace runner → trace
 *   javascript — node run → verdicts → acorn-instrumented trace run
 *   java    — single-file java run → verdicts (no trace yet)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTraceJsonl,
  type ExecutionResult,
  type JobRequest,
  type TestVerdict,
  type Trace,
} from "@codeautopsy/schemas";
import { instrument, instrumentJs, runtimeHeaderPath } from "@codeautopsy/instrumenter";
import { alignTraces } from "@codeautopsy/trace-core";
import { buildReport } from "@codeautopsy/explanation";
import type { Sandbox, RunResult } from "./sandbox";
import { createSandbox } from "./sandbox";

const here = dirname(fileURLToPath(import.meta.url));
const PYTHON_RUNNER = join(here, "..", "assets", "autopsy_python_runner.py");
const TRACE_PROBE_FLAGS = ["-O0", "-include", runtimeHeaderPath, "-DAUTOPSY=1"];

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

function judgeRun(run: RunResult, expectedOutput: string): { status: TestVerdict["status"]; detail?: string } {
  if (run.timedOut) return { status: "timeout" };
  if (run.exitCode !== 0) {
    return {
      status: "runtime_error",
      detail: run.stderr.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300) || `exit code ${run.exitCode}`,
    };
  }
  if (expectedOutput.trim() === "") {
    // playground mode: no expected output — running cleanly is the pass condition
    return { status: "accepted" };
  }
  if (normalizeOutput(run.stdout) !== normalizeOutput(expectedOutput)) {
    return { status: "wrong_answer", detail: firstMismatch(run.stdout, expectedOutput) };
  }
  return { status: "accepted" };
}

function emptyResult(): ExecutionResult {
  return {
    ok: false,
    compileError: null,
    verdicts: [],
    studentTraces: {},
    referenceTraces: {},
    report: null,
  };
}

export async function processJob(job: JobRequest): Promise<ExecutionResult> {
  const sandbox = createSandbox();
  const language = job.language ?? job.problem.language ?? "cpp";
  try {
    switch (language) {
      case "python":
        return await runPythonPipeline(job, sandbox);
      case "javascript":
        return await runJsPipeline(job, sandbox);
      case "java":
        return await runJavaPipeline(job, sandbox);
      default:
        return await runCppPipeline(job, sandbox);
    }
  } finally {
    sandbox.cleanup();
  }
}

/* ------------------------------------------------------------------ */
/* shared tail: trace parsing, alignment, report                       */
/* ------------------------------------------------------------------ */

function readTraceFile(sandbox: Sandbox, file: string, meta: Trace["meta"]): Trace | null {
  try {
    const raw = readFileSync(join(workdirOf(sandbox), file), "utf8");
    let truncated = false;
    const filtered: string[] = [];
    for (const l of raw.split("\n")) {
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
    const { trace } = parseTraceJsonl(filtered.join("\n"), { ...meta, truncated });
    return trace;
  } catch {
    return null;
  }
}

async function finish(
  result: ExecutionResult,
  job: JobRequest,
  firstFailed: TestVerdict | undefined,
): Promise<ExecutionResult> {
  let divergence = null as ReturnType<typeof alignTraces>["divergence"];
  let studentTrace: Trace | undefined;
  let referenceTrace: Trace | undefined;
  if (firstFailed) {
    studentTrace = result.studentTraces[firstFailed.testId];
    referenceTrace = result.referenceTraces[firstFailed.testId];
    if (studentTrace && referenceTrace) {
      divergence = alignTraces(studentTrace, referenceTrace, firstFailed.testId).divergence;
    }
  }
  const { report } = await buildReport(result, studentTrace, referenceTrace, divergence, job.problem.bugHint);
  result.report = report;
  result.language = job.language ?? job.problem.language ?? "cpp";
  result.referenceSource = job.problem.referenceSource;
  result.ok = true;
  return result;
}

function workdirOf(sandbox: Sandbox): string {
  return (sandbox as unknown as { dir: string }).dir;
}

/* ------------------------------------------------------------------ */
/* C / C++                                                             */
/* ------------------------------------------------------------------ */

async function runCppPipeline(job: JobRequest, sandbox: Sandbox): Promise<ExecutionResult> {
  const problem = job.problem;
  const result = emptyResult();
  const hasReference = problem.referenceSource.trim().length > 0;
  const studentBin = `student_${job.jobId}`;
  const refBin = `reference_${job.jobId}`;

  const studentCompile = await sandbox.compile("student", job.source, [], studentBin);
  if (!studentCompile.ok) {
    result.compileError = { side: "student", stderr: studentCompile.stderr.slice(-4000) };
    result.report = (await buildReport(result, undefined, undefined, null, problem.bugHint)).report;
    return result;
  }
  if (hasReference) {
    const refCompile = await sandbox.compile("reference", problem.referenceSource, [], refBin);
    if (!refCompile.ok) {
      result.compileError = { side: "reference", stderr: refCompile.stderr.slice(-4000) };
      result.report = (await buildReport(result, undefined, undefined, null, problem.bugHint)).report;
      return result;
    }
  }

  for (const test of problem.tests) {
    const run = await sandbox.run(studentBin, {
      input: test.input,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    });
    const { status, detail } = judgeRun(run, test.expectedOutput);
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      durationMs: run.durationMs,
    });
  }

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
          if (verdict.status === "timeout") continue;
          const studentTrace = await traceCppRun(sandbox, studentTraceBin, test, "student", problem);
          if (studentTrace) result.studentTraces[test.id] = studentTrace;
          if (refInst !== null && rtc !== null) {
            const refTrace = await traceCppRun(sandbox, refTraceBin, test, "reference", problem);
            if (refTrace) result.referenceTraces[test.id] = refTrace;
          }
        }
      }
    } catch (err) {
      console.error("[pipeline] autopsy stage failed:", err);
    }
  }

  return finish(result, job, result.verdicts.find((v) => v.status !== "accepted"));
}

async function traceCppRun(
  sandbox: Sandbox,
  exeName: string,
  test: JobRequest["problem"]["tests"][number],
  side: "student" | "reference",
  problem: JobRequest["problem"],
): Promise<Trace | null> {
  const traceFile = `trace_${side}_${test.id}.jsonl`;
  const timeBudget = Math.max(500, problem.timeLimitMs - 400);
  const run = await sandbox.run(exeName, {
    input: test.input,
    timeLimitMs: problem.timeLimitMs + 1000,
    memoryLimitMb: problem.memoryLimitMb,
    env: {
      AUTOPSY_TRACE_PATH: join(workdirOf(sandbox), traceFile),
      AUTOPSY_MAX_EVENTS: "200000",
      AUTOPSY_TIME_BUDGET_MS: String(timeBudget),
    },
  });
  if (run.timedOut) return null;
  return readTraceFile(sandbox, traceFile, {
    problemId: problem.slug,
    testId: test.id,
    side,
    exitCode: run.exitCode ?? 0,
    durationMs: run.durationMs,
    truncated: false,
  });
}

/* ------------------------------------------------------------------ */
/* Python                                                              */
/* ------------------------------------------------------------------ */

function pythonBin(): string {
  return process.env.AUTOPSY_PYTHON || "python";
}

async function runPythonPipeline(job: JobRequest, sandbox: Sandbox): Promise<ExecutionResult> {
  const problem = job.problem;
  const result = emptyResult();
  const hasReference = problem.referenceSource.trim().length > 0;
  result.language = "python";
  sandbox.writeFile("main.py", job.source);
  if (hasReference) sandbox.writeFile("reference.py", problem.referenceSource);
  try {
    sandbox.writeFile("autopsy_runner.py", readFileSync(PYTHON_RUNNER, "utf8"));
  } catch (err) {
    console.error("[pipeline] python runner asset missing:", err);
  }

  for (const test of problem.tests) {
    const run = await sandbox.exec([pythonBin(), "main.py"], {
      input: test.input,
      timeoutMs: problem.timeLimitMs,
    });
    const { status, detail } = judgeRun(run, test.expectedOutput);
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      durationMs: run.durationMs,
    });
  }

  const failedVerdicts = result.verdicts.filter((v) => v.status !== "accepted");
  if (job.autopsy && (failedVerdicts.length > 0 || !hasReference)) {
    for (const test of problem.tests) {
      const verdict = result.verdicts.find((v) => v.testId === test.id)!;
      if (verdict.status === "timeout") continue;
      const studentTrace = await tracePythonRun(sandbox, "main.py", test, "student", problem);
      if (studentTrace) result.studentTraces[test.id] = studentTrace;
      if (hasReference) {
        const refTrace = await tracePythonRun(sandbox, "reference.py", test, "reference", problem);
        if (refTrace) result.referenceTraces[test.id] = refTrace;
      }
    }
  }

  return finish(result, job, result.verdicts.find((v) => v.status !== "accepted"));
}

async function tracePythonRun(
  sandbox: Sandbox,
  script: string,
  test: JobRequest["problem"]["tests"][number],
  side: "student" | "reference",
  problem: JobRequest["problem"],
): Promise<Trace | null> {
  const traceFile = `trace_${side}_${test.id}.jsonl`;
  const run = await sandbox.exec([pythonBin(), "autopsy_runner.py", script], {
    input: test.input,
    timeoutMs: problem.timeLimitMs + 3000, // tracing overhead
    env: {
      AUTOPSY_TRACE_PATH: join(workdirOf(sandbox), traceFile),
      AUTOPSY_MAX_EVENTS: "200000",
      AUTOPSY_TIME_BUDGET_MS: String(Math.max(500, problem.timeLimitMs - 400)),
      PYTHONIOENCODING: "utf-8",
    },
  });
  if (run.timedOut) return null;
  return readTraceFile(sandbox, traceFile, {
    problemId: problem.slug,
    testId: test.id,
    side,
    exitCode: run.exitCode ?? 0,
    durationMs: run.durationMs,
    truncated: false,
  });
}

/* ------------------------------------------------------------------ */
/* JavaScript (Node)                                                   */
/* ------------------------------------------------------------------ */

function nodeBin(): string {
  return process.env.AUTOPSY_NODE || "node";
}

async function runJsPipeline(job: JobRequest, sandbox: Sandbox): Promise<ExecutionResult> {
  const problem = job.problem;
  const result = emptyResult();
  const hasReference = problem.referenceSource.trim().length > 0;
  result.language = "javascript";
  sandbox.writeFile("main.js", job.source);
  if (hasReference) sandbox.writeFile("reference.js", problem.referenceSource);

  for (const test of problem.tests) {
    const run = await sandbox.exec([nodeBin(), "main.js"], {
      input: test.input,
      timeoutMs: problem.timeLimitMs,
    });
    const { status, detail } = judgeRun(run, test.expectedOutput);
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      durationMs: run.durationMs,
    });
  }

  const failedVerdicts = result.verdicts.filter((v) => v.status !== "accepted");
  if (job.autopsy && (failedVerdicts.length > 0 || !hasReference)) {
    try {
      const studentInst = instrumentJs(job.source);
      const studentFile = studentInst.moduleKind === "esm" ? "main.traced.mjs" : "main.traced.cjs";
      sandbox.writeFile(studentFile, studentInst.code);
      const refInst = hasReference ? instrumentJs(problem.referenceSource) : null;
      const refFile = refInst ? (refInst.moduleKind === "esm" ? "reference.traced.mjs" : "reference.traced.cjs") : null;
      if (refInst && refFile) sandbox.writeFile(refFile, refInst.code);

      for (const test of problem.tests) {
        const verdict = result.verdicts.find((v) => v.testId === test.id)!;
        if (verdict.status === "timeout") continue;
        const studentTrace = await traceJsRun(sandbox, studentFile, test, "student", problem);
        if (studentTrace) result.studentTraces[test.id] = studentTrace;
        if (refFile) {
          const refTrace = await traceJsRun(sandbox, refFile, test, "reference", problem);
          if (refTrace) result.referenceTraces[test.id] = refTrace;
        }
      }
    } catch (err) {
      console.error("[pipeline] js autopsy stage failed:", err);
    }
  }

  return finish(result, job, result.verdicts.find((v) => v.status !== "accepted"));
}

async function traceJsRun(
  sandbox: Sandbox,
  file: string,
  test: JobRequest["problem"]["tests"][number],
  side: "student" | "reference",
  problem: JobRequest["problem"],
): Promise<Trace | null> {
  const traceFile = `trace_${side}_${test.id}.jsonl`;
  const run = await sandbox.exec([nodeBin(), file], {
    input: test.input,
    timeoutMs: problem.timeLimitMs + 2000,
    env: {
      AUTOPSY_TRACE_PATH: join(workdirOf(sandbox), traceFile),
      AUTOPSY_MAX_EVENTS: "200000",
      AUTOPSY_TIME_BUDGET_MS: String(Math.max(500, problem.timeLimitMs - 400)),
    },
  });
  if (run.timedOut) return null;
  return readTraceFile(sandbox, traceFile, {
    problemId: problem.slug,
    testId: test.id,
    side,
    exitCode: run.exitCode ?? 0,
    durationMs: run.durationMs,
    truncated: false,
  });
}

/* ------------------------------------------------------------------ */
/* Java (single-file source launch; verdicts + output, no trace yet)   */
/* ------------------------------------------------------------------ */

async function runJavaPipeline(job: JobRequest, sandbox: Sandbox): Promise<ExecutionResult> {
  const problem = job.problem;
  const result = emptyResult();
  result.language = "java";

  const className = /public\s+(?:final\s+|abstract\s+)?class\s+(\w+)/.exec(job.source)?.[1];
  const file = `${className ?? "Main"}.java`;
  sandbox.writeFile(file, job.source);

  for (const test of problem.tests) {
    const run = await sandbox.exec([process.env.AUTOPSY_JAVA || "java", file], {
      input: test.input,
      timeoutMs: problem.timeLimitMs + 2000, // JVM startup
    });
    const { status, detail } = judgeRun(run, test.expectedOutput);
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      durationMs: run.durationMs,
    });
  }

  return finish(result, job, result.verdicts.find((v) => v.status !== "accepted"));
}

export { normalizeOutput, firstMismatch };
