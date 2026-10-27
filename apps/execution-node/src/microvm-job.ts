import { readFileSync, writeFileSync, renameSync, openSync, closeSync, mkdirSync } from "node:fs";
import { JobRequest, type ExecutionResult } from "@codeautopsy/schemas";
import { processJob } from "./pipeline";

const destination = "/vercel/sandbox/result.json";
mkdirSync("/vercel/sandbox", { recursive: true, mode: 0o755 });
const failure = (error: string): ExecutionResult => ({
  ok: false,
  compileError: null,
  verdicts: [],
  studentTraces: {},
  referenceTraces: {},
  report: null,
  error,
});
function save(result: ExecutionResult) {
  writeFileSync(destination + ".tmp", JSON.stringify(result), { mode: 0o644 });
  renameSync(destination + ".tmp", destination);
}

// The parent shell holds a file lock. Marker/result files are outside the
// submitted program's filesystem namespace. No hosting credentials enter this VM.
closeSync(openSync("/vercel/sandbox/started", "w", 0o644));
const watchdog = setTimeout(
  () => {
    save(
      failure(
        "Execution exceeded the ten-minute job budget. Reduce the number of tests or retry a smaller run.",
      ),
    );
    process.exit(1);
  },
  10 * 60 * 1000,
);

async function main() {
  try {
    const data = readFileSync(process.argv[2] ?? 0);
    if (data.length > 8 * 1024 * 1024) throw new Error("Job input is too large");
    const job = JobRequest.parse(JSON.parse(data.toString("utf8")));
    if (job.problem.memoryLimitMb !== Number(process.env.AUTOPSY_VM_MEMORY_MB))
      throw new Error("Job memory profile does not match the VM limit");
    save(await processJob(job));
  } catch {
    save(
      failure(
        "The isolated execution could not finish. Retry the submission or inspect deployment diagnostics.",
      ),
    );
  } finally {
    clearTimeout(watchdog);
  }
}
void main();
