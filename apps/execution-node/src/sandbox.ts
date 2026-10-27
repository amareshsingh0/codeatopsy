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
  readFileSync,
  lstatSync,
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
  readonly kind: "local" | "docker" | "microvm";
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
  readonly kind: "docker" | "microvm" = "docker";
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
  protected container(cmd: string[], opts: ExecOptions, writableWork: boolean): Promise<RunResult> {
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

/** One credential-free Vercel VM per job; fresh PID/net/filesystem namespaces
 * per process. The VM enforces the advertised aggregate memory boundary. */
export class MicrovmSandbox extends DockerSandbox {
  readonly kind = "microvm" as const;
  private readonly memoryMb: number;
  constructor() {
    super();
    this.memoryMb = Number(process.env.AUTOPSY_VM_MEMORY_MB);
    const actual = Number(readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim());
    if (
      process.env.AUTOPSY_ISOLATED_VM !== "1" ||
      !Number.isFinite(actual) ||
      actual > this.memoryMb * 1024 * 1024 ||
      ![2048, 4096].includes(this.memoryMb)
    )
      throw new Error("An isolated, memory-bounded VM is required");
  }
  protected async container(cmd: string[], opts: ExecOptions, writableWork: boolean): Promise<RunResult> {
    if (opts.memoryLimitMb !== undefined && opts.memoryLimitMb !== this.memoryMb)
      throw new Error("Requested memory limit does not match the isolated VM profile");
    const stage = mkdtempSync(join(this.dir, "stage-"));
    const traceDir = mkdtempSync(join(this.dir, "trace-stage-"));
    chmodSync(stage, 0o777);
    chmodSync(traceDir, 0o777);
    try {
      // Never expose other-side sources, binaries, inputs, or controller files.
      for (const argument of cmd) {
        const name = argument.startsWith("/work/") ? argument.slice(6) : argument;
        if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === "." || name === "..") continue;
        const source = join(this.dir, name);
        try {
          const stat = lstatSync(source);
          if (!stat.isFile() || stat.isSymbolicLink()) continue;
          copyFileSync(source, join(stage, name));
          chmodSync(join(stage, name), stat.mode & 0o111 ? 0o755 : 0o644);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      const result = await spawnCmd(
        "prlimit",
        [
          "--nproc=128:128",
          "--nofile=128:128",
          "--fsize=16777216:16777216",
          `--cpu=${Math.ceil((opts.timeoutMs ?? 30000) / 1000) + 1}`,
          "--",
          "bwrap",
          "--unshare-pid",
          "--unshare-net",
          "--unshare-ipc",
          "--unshare-uts",
          "--die-with-parent",
          "--new-session",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "CAP_SETUID",
          "--cap-add",
          "CAP_SETGID",
          "--cap-add",
          "CAP_SETPCAP",
          "--ro-bind",
          "/opt/codeautopsy/rootfs",
          "/",
          "--proc",
          "/proc",
          "--dev",
          "/dev",
          "--tmpfs",
          "/tmp",
          writableWork ? "--bind" : "--ro-bind",
          stage,
          "/work",
          "--bind",
          traceDir,
          "/trace",
          "--chdir",
          "/work",
          "--",
          "setpriv",
          "--bounding-set=-all",
          "--reuid=1000",
          "--regid=1000",
          "--clear-groups",
          "--no-new-privs",
          ...cmd,
        ],
        { ...opts, cwd: this.dir },
      );
      const outputIndex = cmd.indexOf("-o");
      if (writableWork && outputIndex !== -1 && result.exitCode === 0) {
        const output = filename(cmd[outputIndex + 1].replace(/^\/work\//, ""));
        const stat = lstatSync(join(stage, output));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
          throw new Error("Compiler output is invalid or too large");
        copyFileSync(join(stage, output), join(this.dir, output));
        chmodSync(join(this.dir, output), 0o755);
      }
      const trace = opts.env?.AUTOPSY_TRACE_PATH;
      if (trace?.startsWith("/trace/")) {
        const name = filename(trace.slice(7));
        try {
          const stat = lstatSync(join(traceDir, name));
          if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 16 * 1024 * 1024)
            copyFileSync(join(traceDir, name), join(this.dir, "traces", name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      return result;
    } finally {
      rmSync(stage, { recursive: true, force: true });
      rmSync(traceDir, { recursive: true, force: true });
    }
  }
}

export function createSandbox(): Sandbox {
  const mode = process.env.AUTOPSY_SANDBOX ?? "local";
  if (mode === "docker") return new DockerSandbox();
  if (mode === "microvm") return new MicrovmSandbox();
  if (mode !== "local") throw new Error("Unknown AUTOPSY_SANDBOX: " + mode);
  if (process.env.NODE_ENV === "production" && process.env.AUTOPSY_ALLOW_LOCAL_EXECUTION !== "true") {
    throw new Error(
      "Production execution requires AUTOPSY_SANDBOX=docker. Trusted local execution requires explicit AUTOPSY_ALLOW_LOCAL_EXECUTION=true.",
    );
  }
  return new LocalSandbox();
}
