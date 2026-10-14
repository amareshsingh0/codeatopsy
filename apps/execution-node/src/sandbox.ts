import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { osTmpdir } from "./util";

export interface CompileResult {
  ok: boolean;
  stderr: string;
  durationMs: number;
}
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outputLimitExceeded?: boolean;
}
export interface RunOptions {
  input: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  env?: Record<string, string>;
}
export interface ExecOptions {
  input?: string;
  timeoutMs?: number;
  memoryLimitMb?: number;
  env?: Record<string, string>;
}
export interface Sandbox {
  readonly kind: "local" | "docker";
  readonly dir: string;
  path(name: string): string;
  tracePath(name: string): string;
  writeFile(name: string, content: string): void;
  exec(cmd: string[], opts: ExecOptions): Promise<RunResult>;
  compile(
    key: string,
    source: string,
    flags: string[],
    out: string,
    language?: "cpp" | "c",
  ): Promise<CompileResult>;
  run(name: string, opts: RunOptions): Promise<RunResult>;
  cleanup(): void;
}

// Submitted programs receive toolchain settings, never worker credentials.
function runtimeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "PATHEXT",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, PYTHONIOENCODING: "utf-8", ...extra };
}
function filename(name: string): string {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === "..")
    throw new Error("Invalid sandbox filename");
  return name;
}
interface SpawnOptions extends ExecOptions {
  cwd?: string;
  onTerminate?: () => Promise<void>;
}
export function spawnCmd(cmd: string, args: string[], opts: SpawnOptions): Promise<RunResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    // A regular stdin file supports streams and readFileSync(0) on Windows.
    const inputPath = join(opts.cwd ?? osTmpdir(), "stdin-" + randomUUID() + ".txt");
    writeFileSync(inputPath, opts.input ?? "");
    const fd = openSync(inputPath, "r");
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: runtimeEnv(opts.env),
      stdio: [fd, "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    closeSync(fd);
    let stdout = "",
      stderr = "",
      timedOut = false,
      outputLimitExceeded = false;
    let settled = false,
      stopping = false;
    let termination: Promise<void> = Promise.resolve();
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const cap = 256 * 1024;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      void termination.finally(() => {
        try {
          rmSync(inputPath, { force: true });
        } catch {
          /* cleanup retries at job end */
        }
        resolve({ stdout, stderr, exitCode, timedOut, outputLimitExceeded, durationMs: Date.now() - start });
      });
    };
    const stop = () => {
      if (stopping) return;
      stopping = true;
      if (opts.onTerminate) termination = opts.onTerminate().catch(() => {});
      if (child.pid) {
        if (process.platform === "win32") {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
          killer.on("error", () => child.kill());
        } else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }
      forceTimer = setTimeout(() => finish(null), 3000);
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk.slice(0, Math.max(0, cap - stdout.length));
      if (stdout.length >= cap) {
        outputLimitExceeded = true;
        stop();
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk.slice(0, Math.max(0, cap - stderr.length));
      if (stderr.length >= cap) {
        outputLimitExceeded = true;
        stop();
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs ?? 30000);
    child.on("error", (err) => {
      stderr += "\n" + err.message;
      finish(null);
    });
    child.on("close", finish);
  });
}
export class LocalSandbox implements Sandbox {
  readonly kind = "local" as const;
  readonly dir = mkdtempSync(join(osTmpdir(), "ca-exec-"));
  path(name: string) {
    return join(this.dir, filename(name));
  }
  tracePath(name: string) {
    return this.path(name);
  }
  writeFile(name: string, content: string) {
    writeFileSync(this.path(name), content);
  }
  exec(cmd: string[], opts: ExecOptions) {
    return spawnCmd(cmd[0], cmd.slice(1), { ...opts, cwd: this.dir });
  }
  async compile(
    _key: string,
    source: string,
    flags: string[],
    out: string,
    language: "cpp" | "c" = "cpp",
  ): Promise<CompileResult> {
    const name = language === "c" ? "src.c" : "src.cpp";
    this.writeFile(name, source);
    const compiler = language === "c" ? process.env.AUTOPSY_CC || "gcc" : process.env.AUTOPSY_CXX || "g++";
    const std = language === "c" ? "-std=c11" : process.env.AUTOPSY_CXX_STD || "-std=c++17";
    const r = await this.exec([compiler, std, "-O2", ...flags, "-o", this.path(out), this.path(name)], {
      timeoutMs: 30000,
    });
    return {
      ok: r.exitCode === 0 && !r.timedOut && !r.outputLimitExceeded,
      stderr: r.stderr || (r.timedOut ? "Compilation exceeded 30 seconds" : ""),
      durationMs: r.durationMs,
    };
  }
  run(name: string, opts: RunOptions) {
    const executable = process.platform === "win32" ? filename(name) + ".exe" : name;
    return this.exec([this.path(executable)], {
      input: opts.input,
      timeoutMs: opts.timeLimitMs,
      env: opts.env,
    });
  }
  cleanup() {
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
export class DockerSandbox implements Sandbox {
  readonly kind = "docker" as const;
  readonly dir: string;
  private readonly image = process.env.AUTOPSY_DOCKER_IMAGE || "codeautopsy-sandbox:local";
  constructor() {
    this.dir = mkdtempSync(join(process.env.AUTOPSY_WORK_DIR || osTmpdir(), "ca-docker-"));
    chmodSync(this.dir, 0o777);
    mkdirSync(join(this.dir, "traces"), { mode: 0o777 });
    chmodSync(join(this.dir, "traces"), 0o777);
  }
  path(name: string) {
    return "/work/" + filename(name);
  }
  tracePath(name: string) {
    return "/trace/" + filename(name);
  }
  writeFile(name: string, content: string) {
    writeFileSync(join(this.dir, filename(name)), content);
  }
  exec(cmd: string[], opts: ExecOptions): Promise<RunResult> {
    return this.container(cmd, opts, false);
  }
  private container(cmd: string[], opts: ExecOptions, writableWork: boolean): Promise<RunResult> {
    const name = "ca-" + randomUUID();
    const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", k + "=" + v]);
    return spawnCmd(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "-i",
        "--init",
        "--network=none",
        "--memory=" + (opts.memoryLimitMb ?? 512) + "m",
        "--memory-swap=" + (opts.memoryLimitMb ?? 512) + "m",
        "--cpus=1",
        "--pids-limit=128",
        "--security-opt=no-new-privileges",
        "--cap-drop=ALL",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=64m",
        "--user",
        "1000:1000",
        "-v",
        this.dir + ":/work" + (writableWork ? "" : ":ro"),
        ...(!writableWork ? ["-v", join(this.dir, "traces") + ":/trace"] : []),
        "-w",
        "/work",
        ...envArgs,
        this.image,
        ...cmd,
      ],
      {
        ...opts,
        cwd: this.dir,
        env: undefined,
        onTerminate: async () => {
          await spawnCmd("docker", ["rm", "-f", name], { timeoutMs: 10000 });
        },
      },
    );
  }
  async compile(
    _key: string,
    source: string,
    flags: string[],
    out: string,
    language: "cpp" | "c" = "cpp",
  ): Promise<CompileResult> {
    const name = language === "c" ? "src.c" : "src.cpp";
    this.writeFile(name, source);
    const mapped = [...flags];
    for (let i = 0; i < mapped.length - 1; i++) {
      if (mapped[i] === "-include") {
        copyFileSync(mapped[i + 1], join(this.dir, "trace-runtime.hpp"));
        mapped[i + 1] = this.path("trace-runtime.hpp");
      }
    }
    const r = await this.container(
      [
        language === "c" ? "gcc" : "g++",
        language === "c" ? "-std=c17" : "-std=c++17",
        "-O2",
        ...mapped,
        "-o",
        this.path(out),
        this.path(name),
      ],
      { timeoutMs: 60000 },
      true,
    );
    return {
      ok: r.exitCode === 0 && !r.timedOut && !r.outputLimitExceeded,
      stderr: r.stderr || (r.timedOut ? "Compilation exceeded 60 seconds" : ""),
      durationMs: r.durationMs,
    };
  }
  run(name: string, opts: RunOptions) {
    return this.exec([this.path(name)], {
      input: opts.input,
      timeoutMs: opts.timeLimitMs,
      memoryLimitMb: opts.memoryLimitMb,
      env: opts.env,
    });
  }
  cleanup() {
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
export function createSandbox(): Sandbox {
  const mode = process.env.AUTOPSY_SANDBOX ?? "local";
  if (mode === "docker") return new DockerSandbox();
  if (mode !== "local") throw new Error("Unknown AUTOPSY_SANDBOX: " + mode);
  if (process.env.NODE_ENV === "production" && process.env.AUTOPSY_ALLOW_LOCAL_EXECUTION !== "true") {
    throw new Error(
      "Production execution requires AUTOPSY_SANDBOX=docker. Trusted local execution requires explicit AUTOPSY_ALLOW_LOCAL_EXECUTION=true.",
    );
  }
  return new LocalSandbox();
}
