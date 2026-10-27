/**
 * The full autopsy pipeline for one submission, dispatched by language:
 *   cpp/c   — native compiler → verdicts → instrument both sides → traces → divergence
 *   python  — interpreter run → verdicts → sys.settrace runner → trace
 *   javascript — node run → verdicts → acorn-instrumented trace run
 *   java    — single-file java run → verdicts (no trace yet)
 */
import { existsSync, readFileSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
import { boundResultPreviews } from "./result-budget";

const here = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return "";
  }
})();
const PYTHON_RUNNER = (() => {
  const candidates: string[] = [];
  if (here) candidates.push(resolve(here, "..", "assets", "autopsy_python_runner.py"));
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.push(join(dir, "apps", "execution-node", "assets", "autopsy_python_runner.py"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
})();
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

function judgeRun(
  run: RunResult,
  expectedOutput: string,
  allowUncheckedOutput = false,
): { status: TestVerdict["status"]; detail?: string } {
  if (run.timedOut) return { status: "timeout" };
  if (run.outputLimitExceeded)
    return { status: "runtime_error", detail: "Program exceeded the 256 KB output limit" };
  if (run.exitCode !== 0) {
    return {
      status: "runtime_error",
      detail:
        run.stderr.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300) ||
        `exit code ${run.exitCode}`,
    };
  }
  if (expectedOutput === "" && allowUncheckedOutput) {
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
        return boundResultPreviews(await runPythonPipeline(job, sandbox));
      case "javascript":
        return boundResultPreviews(await runJsPipeline(job, sandbox));
      case "java":
        return boundResultPreviews(await runJavaPipeline(job, sandbox));
      default:
        return boundResultPreviews(await runCppPipeline(job, sandbox));
    }
  } finally {
    try {
      sandbox.cleanup();
    } catch (err) {
      console.error("[pipeline] cleanup failed:", err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* shared tail: trace parsing, alignment, report                       */
/* ------------------------------------------------------------------ */

const traceBudgets = new WeakMap<Sandbox, { bytes: number; events: number }>();
function readTraceFile(sandbox: Sandbox, file: string, meta: Trace["meta"]): Trace | null {
  try {
    const path = sandbox.kind !== "local" ? join(sandbox.dir, "traces", file) : join(sandbox.dir, file);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) return null;
    const budget = traceBudgets.get(sandbox) ?? { bytes: 16 * 1024 * 1024, events: 20000 };
    traceBudgets.set(sandbox, budget);
    if (stat.size > budget.bytes || budget.events === 0)
      return { meta: { ...meta, truncated: true }, events: [] };
    budget.bytes -= stat.size;
    const raw = readFileSync(path, "utf8");
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
    if (trace.events.length > budget.events) {
      trace.events = trace.events.slice(0, budget.events);
      trace.meta.truncated = true;
    }
    budget.events -= trace.events.length;
    return trace.events.length ? trace : null;
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
  if (job.autopsy && Object.keys(result.studentTraces).length === 0 && !result.warnings?.length) {
    (result.warnings ??= []).push(
      result.language === "java"
        ? "Java execution is supported; Java tracing is not implemented yet."
        : "No trace was collected for this run. Verdicts and output remain available.",
    );
  }
  result.ok = true;
  return result;
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

  const nativeLanguage = (job.language ?? problem.language) === "c" ? "c" : "cpp";
  result.language = nativeLanguage;
  const studentCompile = await sandbox.compile("student", job.source, [], studentBin, nativeLanguage);
  if (!studentCompile.ok) {
    result.compileError = { side: "student", stderr: studentCompile.stderr.slice(-4000) };
    result.report = (await buildReport(result, undefined, undefined, null, problem.bugHint)).report;
    return result;
  }
  if (hasReference) {
    const refCompile = await sandbox.compile(
      "reference",
      problem.referenceSource,
      [],
      refBin,
      nativeLanguage,
    );
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
    const { status, detail } = judgeRun(run, test.expectedOutput, !hasReference);
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      stderr: run.stderr.slice(-4000) || undefined,
      durationMs: run.durationMs,
    });
  }

  const failedVerdicts = result.verdicts.filter((v) => v.status !== "accepted");
  if (job.autopsy && (failedVerdicts.length > 0 || !hasReference)) {
    try {
      const studentInst = instrument(job.source);
      if (studentInst.notes.length)
        (result.warnings ??= []).push(...studentInst.notes.map((note) => `Trace coverage: ${note}`));
      const refInst = hasReference ? instrument(problem.referenceSource) : null;
      const studentTraceBin = `student_traced_${job.jobId}`;
      const refTraceBin = `reference_traced_${job.jobId}`;

      const stc = await sandbox.compile("student", studentInst.code, TRACE_PROBE_FLAGS, studentTraceBin);
      const rtc =
        refInst !== null
          ? await sandbox.compile("reference", refInst.code, TRACE_PROBE_FLAGS, refTraceBin)
          : null;

      if (stc.ok && (rtc === null || rtc.ok)) {
        const selectedTests = hasReference
          ? problem.tests.filter((t) => t.id === failedVerdicts[0]?.testId)
          : problem.tests;
        for (const test of selectedTests) {
          const verdict = result.verdicts.find((v) => v.testId === test.id)!;
          const studentTrace = await traceCppRun(sandbox, studentTraceBin, test, "student", problem);
          if (studentTrace) result.studentTraces[test.id] = studentTrace;
          if (refInst !== null && rtc !== null) {
            const refTrace = await traceCppRun(sandbox, refTraceBin, test, "reference", problem);
            if (refTrace) result.referenceTraces[test.id] = refTrace;
          }
        }
      } else {
        (result.warnings ??= []).push(
          `Trace compilation failed${nativeLanguage === "c" ? " (C tracing currently requires C++-compatible source)" : ""}: ${(stc.ok ? rtc?.stderr : stc.stderr)?.slice(-1500)}`,
        );
      }
    } catch (err) {
      (result.warnings ??= []).push(
        `Trace instrumentation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return finish(
    result,
    job,
    result.verdicts.find((v) => v.status !== "accepted"),
  );
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
      AUTOPSY_TRACE_PATH: sandbox.tracePath(traceFile),
      AUTOPSY_MAX_EVENTS: "20000",
      AUTOPSY_TIME_BUDGET_MS: String(timeBudget),
    },
  });
  const trace = readTraceFile(sandbox, traceFile, {
    problemId: problem.slug,
    testId: test.id,
    side,
    exitCode: run.exitCode ?? 0,
    durationMs: run.durationMs,
    truncated: false,
  });
  if (trace && run.timedOut) trace.meta.truncated = true;
  return trace;
}

/* ------------------------------------------------------------------ */
/* Python                                                              */
/* ------------------------------------------------------------------ */

function pythonBin(sandbox: Sandbox): string {
  return sandbox.kind !== "local"
    ? "python3"
    : process.env.AUTOPSY_PYTHON || (process.platform === "win32" ? "python" : "python3");
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
    (result.warnings ??= []).push(
      `Python trace runner unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  for (const test of problem.tests) {
    const run = await sandbox.exec([pythonBin(sandbox), "main.py"], {
      input: test.input,
      timeoutMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    });
    const { status, detail } = judgeRun(run, test.expectedOutput, !hasReference);
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      stderr: run.stderr.slice(-4000) || undefined,
      durationMs: run.durationMs,
    });
  }

  const failedVerdicts = result.verdicts.filter((v) => v.status !== "accepted");
  if (job.autopsy && (failedVerdicts.length > 0 || !hasReference)) {
    for (const test of hasReference
      ? problem.tests.filter((t) => t.id === failedVerdicts[0]?.testId)
      : problem.tests) {
      const verdict = result.verdicts.find((v) => v.testId === test.id)!;
      const studentTrace = await tracePythonRun(sandbox, "main.py", test, "student", problem);
      if (studentTrace) result.studentTraces[test.id] = studentTrace;
      if (hasReference) {
        const refTrace = await tracePythonRun(sandbox, "reference.py", test, "reference", problem);
        if (refTrace) result.referenceTraces[test.id] = refTrace;
      }
    }
  }

  return finish(
    result,
    job,
    result.verdicts.find((v) => v.status !== "accepted"),
  );
}

async function tracePythonRun(
  sandbox: Sandbox,
  script: string,
  test: JobRequest["problem"]["tests"][number],
  side: "student" | "reference",
  problem: JobRequest["problem"],
): Promise<Trace | null> {
  const traceFile = `trace_${side}_${test.id}.jsonl`;
  const run = await sandbox.exec([pythonBin(sandbox), "autopsy_runner.py", script], {
    input: test.input,
    timeoutMs: problem.timeLimitMs + 3000, // tracing overhead
    memoryLimitMb: problem.memoryLimitMb,
    env: {
      AUTOPSY_TRACE_PATH: sandbox.tracePath(traceFile),
      AUTOPSY_MAX_EVENTS: "20000",
      AUTOPSY_TIME_BUDGET_MS: String(Math.max(500, problem.timeLimitMs - 400)),
      PYTHONIOENCODING: "utf-8",
    },
  });
  const trace = readTraceFile(sandbox, traceFile, {
    problemId: problem.slug,
    testId: test.id,
    side,
    exitCode: run.exitCode ?? 0,
    durationMs: run.durationMs,
    truncated: false,
  });
  if (trace && run.timedOut) trace.meta.truncated = true;
  return trace;
}

/* ------------------------------------------------------------------ */
/* JavaScript (Node)                                                   */
/* ------------------------------------------------------------------ */

function nodeBin(sandbox: Sandbox): string {
  return sandbox.kind !== "local" ? "node" : process.env.AUTOPSY_NODE || process.execPath;
}

async function runJsPipeline(job: JobRequest, sandbox: Sandbox): Promise<ExecutionResult> {
  const problem = job.problem;
  const result = emptyResult();
  const hasReference = problem.referenceSource.trim().length > 0;
  result.language = "javascript";
  let studentInst: ReturnType<typeof instrumentJs> | undefined;
  let refInst: ReturnType<typeof instrumentJs> | undefined;
  try {
    studentInst = instrumentJs(job.source);
  } catch {
    /* runtime reports syntax errors */
  }
  if (hasReference) {
    try {
      refInst = instrumentJs(problem.referenceSource);
    } catch {
      /* handled below */
    }
  }
  const studentFile = studentInst?.moduleKind === "esm" ? "main.mjs" : "main.cjs";
  sandbox.writeFile(studentFile, job.source);

  for (const test of problem.tests) {
    const run = await sandbox.exec([nodeBin(sandbox), studentFile], {
      input: test.input,
      timeoutMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    });
    const { status, detail } = judgeRun(run, test.expectedOutput, !hasReference);
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      stderr: run.stderr.slice(-4000) || undefined,
      durationMs: run.durationMs,
    });
  }

  const failedVerdicts = result.verdicts.filter((v) => v.status !== "accepted");
  if (job.autopsy && (failedVerdicts.length > 0 || !hasReference)) {
    try {
      if (!studentInst) throw new Error("JavaScript could not be parsed for tracing");
      const studentFile = studentInst.moduleKind === "esm" ? "main.traced.mjs" : "main.traced.cjs";
      sandbox.writeFile(studentFile, studentInst.code);
      if (hasReference && !refInst) throw new Error("Reference JavaScript could not be parsed for tracing");
      const refFile = refInst
        ? refInst.moduleKind === "esm"
          ? "reference.traced.mjs"
          : "reference.traced.cjs"
        : null;
      if (refInst && refFile) sandbox.writeFile(refFile, refInst.code);

      for (const test of hasReference
        ? problem.tests.filter((t) => t.id === failedVerdicts[0]?.testId)
        : problem.tests) {
        const verdict = result.verdicts.find((v) => v.testId === test.id)!;
        const studentTrace = await traceJsRun(sandbox, studentFile, test, "student", problem);
        if (studentTrace) result.studentTraces[test.id] = studentTrace;
        if (refFile) {
          const refTrace = await traceJsRun(sandbox, refFile, test, "reference", problem);
          if (refTrace) result.referenceTraces[test.id] = refTrace;
        }
      }
    } catch (err) {
      (result.warnings ??= []).push(
        `JavaScript tracing failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return finish(
    result,
    job,
    result.verdicts.find((v) => v.status !== "accepted"),
  );
}

async function traceJsRun(
  sandbox: Sandbox,
  file: string,
  test: JobRequest["problem"]["tests"][number],
  side: "student" | "reference",
  problem: JobRequest["problem"],
): Promise<Trace | null> {
  const traceFile = `trace_${side}_${test.id}.jsonl`;
  const run = await sandbox.exec([nodeBin(sandbox), file], {
    input: test.input,
    timeoutMs: problem.timeLimitMs + 2000,
    memoryLimitMb: problem.memoryLimitMb,
    env: {
      AUTOPSY_TRACE_PATH: sandbox.tracePath(traceFile),
      AUTOPSY_MAX_EVENTS: "20000",
      AUTOPSY_TIME_BUDGET_MS: String(Math.max(500, problem.timeLimitMs - 400)),
    },
  });
  const trace = readTraceFile(sandbox, traceFile, {
    problemId: problem.slug,
    testId: test.id,
    side,
    exitCode: run.exitCode ?? 0,
    durationMs: run.durationMs,
    truncated: false,
  });
  if (trace && run.timedOut) trace.meta.truncated = true;
  return trace;
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
    const run = await sandbox.exec(
      [sandbox.kind !== "local" ? "java" : process.env.AUTOPSY_JAVA || "java", file],
      {
        input: test.input,
        timeoutMs: problem.timeLimitMs + 2000, // JVM startup
        memoryLimitMb: problem.memoryLimitMb,
      },
    );
    const { status, detail } = judgeRun(run, test.expectedOutput, !problem.referenceSource.trim());
    result.verdicts.push({
      testId: test.id,
      status,
      exitCode: run.exitCode,
      detail,
      output: run.stdout.slice(0, 4000),
      stderr: run.stderr.slice(-4000) || undefined,
      durationMs: run.durationMs,
    });
  }

  return finish(
    result,
    job,
    result.verdicts.find((v) => v.status !== "accepted"),
  );
}

export { normalizeOutput, firstMismatch };
