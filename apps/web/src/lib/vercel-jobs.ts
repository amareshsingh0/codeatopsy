import "server-only";
import { Readable } from "node:stream";
import { Sandbox, Snapshot, APIError } from "@vercel/sandbox";
import { getSandboxJobs, type SandboxJobs } from "@codeautopsy/db";
import { ExecutionResult, JobRequest } from "@codeautopsy/schemas";
import { ExecutionUnavailable } from "./execution-provider";

function status(error: unknown, code: number) {
  return error instanceof APIError && error.response.status === code;
}
export async function assertSandboxReady() {
  await getSandboxJobs().assertReady();
  const snapshot = await Snapshot.get({
    snapshotId: process.env.AUTOPSY_SANDBOX_SNAPSHOT_ID!,
    signal: AbortSignal.timeout(10000),
  });
  if (snapshot.status !== "created") throw new ExecutionUnavailable("Execution toolchain is not ready.");
}
async function resultFile(sandbox: Sandbox) {
  try {
    const stat = await sandbox.fs.stat("/vercel/sandbox/result.json");
    if (stat.size > 2 * 1024 * 1024)
      throw new ExecutionUnavailable("Execution result exceeded the response budget.");
    return ExecutionResult.parse(
      JSON.parse(await sandbox.fs.readFile("/vercel/sandbox/result.json", "utf8")),
    );
  } catch (error) {
    if (status(error, 404) || (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function cleanup(sandbox: Sandbox) {
  try {
    await sandbox.delete({ signal: AbortSignal.timeout(10000) });
  } catch {
    console.error("[sandbox] cleanup deferred to the VM lifetime limit");
  }
}
async function launch(id: string, store: SandboxJobs) {
  const run = await store.claim(id);
  if (!run) return;
  let sandbox: Sandbox | undefined;
  try {
    try {
      sandbox = await Sandbox.get({ name: run.sandbox_name, signal: AbortSignal.timeout(10000) });
    } catch (error) {
      if (!status(error, 404)) throw error;
    }
    if (!sandbox)
      sandbox = await Sandbox.create({
        name: run.sandbox_name,
        source: { type: "snapshot", snapshotId: process.env.AUTOPSY_SANDBOX_SNAPSHOT_ID! },
        resources: { vcpus: 1 },
        timeout: 12 * 60 * 1000,
        persistent: false,
        networkPolicy: "deny-all",
        signal: AbortSignal.timeout(30000),
      });
    let started = false;
    try {
      await sandbox.fs.stat("/vercel/sandbox/started");
      started = true;
    } catch (error) {
      if (!status(error, 404) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!started) {
      const job = JobRequest.parse(run.payload);
      await sandbox.runCommand({
        cmd: "flock",
        args: ["-n", "/tmp/codeautopsy-job.lock", "node", "/opt/codeautopsy/job.cjs"],
        cwd: "/opt/codeautopsy",
        sudo: true,
        detached: true,
        timeoutMs: 10 * 60 * 1000 + 10000,
        stdin: Readable.from([Buffer.from(JSON.stringify(job))]),
        env: {
          NODE_ENV: "production",
          AUTOPSY_SANDBOX: "microvm",
          AUTOPSY_ISOLATED_VM: "1",
          AUTOPSY_VM_MEMORY_MB: "2048",
        },
        signal: AbortSignal.timeout(15000),
      });
    }
    await store.started(id, run.launch_token!);
  } catch (error) {
    // A created VM may already have accepted stdin when an HTTP response is lost.
    // Preserve that identity for polling rather than executing the program twice.
    if (sandbox && !status(error, 402) && !status(error, 429)) return;
    await store.finish(
      id,
      null,
      status(error, 402) || status(error, 429)
        ? "Execution allowance is unavailable. Retry after the hosting quota resets."
        : "The isolated execution environment could not start. Retry shortly.",
    );
    if (sandbox) await cleanup(sandbox);
  }
}
export async function pollSandboxJob(id: string) {
  const store = getSandboxJobs();
  let run = await store.get(id);
  if (!run) return null;
  if (
    run.state === "queued" ||
    (run.state === "starting" && run.launch_until && run.launch_until.getTime() < Date.now())
  ) {
    await launch(id, store);
    run = (await store.get(id))!;
  }
  if (run.state === "starting" || run.state === "running") {
    let sandbox: Sandbox | undefined;
    try {
      sandbox = await Sandbox.get({ name: run.sandbox_name, signal: AbortSignal.timeout(10000) });
      const result = await resultFile(sandbox);
      if (result) {
        await store.finish(id, result);
        await cleanup(sandbox);
      } else if (
        sandbox.status === "stopped" ||
        sandbox.status === "failed" ||
        (run.deadline_at && run.deadline_at.getTime() < Date.now())
      ) {
        await store.finish(
          id,
          null,
          "The isolated VM stopped or reached its execution budget. Retry a smaller run.",
        );
        await cleanup(sandbox);
      }
    } catch (error) {
      if (status(error, 404))
        await store.finish(id, null, "The isolated execution expired. Submit the code again.");
      else throw error;
    }
    run = (await store.get(id))!;
  }
  return {
    status: run.state === "starting" ? ("queued" as const) : run.state,
    result: run.result ?? undefined,
    error: run.error ?? undefined,
  };
}
export async function startSandboxJob(id: string) {
  await launch(id, getSandboxJobs());
}
