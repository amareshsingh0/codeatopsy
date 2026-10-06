/**
 * Sandbox abstraction. A sandbox compiles a set of C++ sources and runs a
 * binary against stdin with resource limits.
 *
 *  - LocalSandbox  — direct child processes; for development on trusted
 *                    machines. NOT a security boundary.
 *  - DockerSandbox — every compile/run goes through a locked-down container
 *                    (no network, memory/CPU/pids caps, non-root); for
 *                    production and untrusted submissions.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { osTmpdir } from "./util";
import { join } from "node:path";

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
}

export interface RunOptions {
  input: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  env?: Record<string, string>;
}

export interface Sandbox {
  readonly kind: "local" | "docker";
  /** write a file into the sandbox workdir */
  writeFile(name: string, content: string): void;
  /** run an arbitrary command inside the sandbox (non-C++ languages) */
  exec(cmd: string[], opts: { input?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<RunResult>;
  /** compile C++ sources into an executable inside the sandbox workdir */
  compile(
    key: string,
    mainSource: string,
    extraFlags: string[],
    outExe: string,
  ): Promise<CompileResult>;
  run(exeName: string, opts: RunOptions): Promise<RunResult>;
  cleanup(): void;
}

function spawnCmd(
  cmd: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number; cwd?: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean; durationMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = 256 * 1024;
    child.stdout.on("data", (d) => {
      if (stdout.length < cap) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < cap) stderr += d.toString("utf8");
    });
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGKILL");
            } catch {
              /* already gone */
            }
          }, opts.timeoutMs)
        : null;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${err.message}`, code: null, timedOut, durationMs: Date.now() - start });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut, durationMs: Date.now() - start });
    });
    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

export class LocalSandbox implements Sandbox {
  readonly kind = "local" as const;
  private readonly dir: string;

  constructor() {
    this.dir = mkdtempSync(join(osTmpdir(), "ca-exec-"));
  }

  writeFile(name: string, content: string): void {
    writeFileSync(join(this.dir, name), content);
  }

  async exec(
    cmd: string[],
    opts: { input?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<RunResult> {
    const r = await spawnCmd(cmd[0], cmd.slice(1), {
      input: opts.input,
      timeoutMs: opts.timeoutMs,
      cwd: this.dir,
      env: opts.env,
    });
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.code,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
    };
  }

  async compile(
    key: string,
    mainSource: string,
    extraFlags: string[],
    outExe: string,
  ): Promise<CompileResult> {
    void key;
    const srcPath = join(this.dir, "src.cpp");
    writeFileSync(srcPath, mainSource);
    const cxx = process.env.AUTOPSY_CXX || "g++";
    const stdFlag = process.env.AUTOPSY_CXX_STD || "-std=c++17";
    const r = await spawnCmd(
      cxx,
      [stdFlag, "-O2", ...extraFlags, "-o", join(this.dir, outExe), srcPath],
      { timeoutMs: 30000 },
    );
    return { ok: r.code === 0 && !r.timedOut, stderr: r.stderr, durationMs: r.durationMs };
  }

  async run(exeName: string, opts: RunOptions): Promise<RunResult> {
    const r = await spawnCmd(join(this.dir, exeName), [], {
      input: opts.input,
      timeoutMs: opts.timeLimitMs,
      cwd: this.dir,
      env: opts.env,
    });
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.code,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
    };
  }

  cleanup(): void {
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

export class DockerSandbox implements Sandbox {
  readonly kind = "docker" as const;
  private readonly dir: string;
  private readonly image: string;

  constructor() {
    this.dir = mkdtempSync(join(osTmpdir(), "ca-docker-"));
    this.image = process.env.AUTOPSY_DOCKER_IMAGE || "gcc:13-bookworm";
  }

  private async docker(args: string[], opts: { input?: string; timeoutMs?: number } = {}) {
    return spawnCmd("docker", args, opts);
  }

  writeFile(name: string, content: string): void {
    writeFileSync(join(this.dir, name), content);
  }

  async exec(
    cmd: string[],
    opts: { input?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<RunResult> {
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(opts.env ?? {})) envArgs.push("-e", `${k}=${v}`);
    const r = await this.docker(
      [
        "run", "--rm", "-i",
        "--network=none",
        "--memory=512m",
        "--cpus=1",
        "--pids-limit=128",
        "--security-opt=no-new-privileges",
        "-v", `${this.dir}:/work`,
        "-w", "/work",
        ...envArgs,
        this.image,
        ...cmd,
      ],
      { input: opts.input, timeoutMs: opts.timeoutMs },
    );
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.code,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
    };
  }

  async compile(
    key: string,
    mainSource: string,
    extraFlags: string[],
    outExe: string,
  ): Promise<CompileResult> {
    void key;
    writeFileSync(join(this.dir, "src.cpp"), mainSource);
    const cxx = process.env.AUTOPSY_CXX || "g++";
    const stdFlag = process.env.AUTOPSY_CXX_STD || "-std=c++17";
    const script = `${cxx} ${stdFlag} -O2 ${extraFlags.join(" ")} -o /work/${outExe} /work/src.cpp 2> /work/compile.err; echo $? > /work/compile.rc`;
    const r = await this.docker(
      [
        "run", "--rm",
        "--network=none",
        "--memory=512m",
        "--cpus=1",
        "--pids-limit=128",
        "--security-opt=no-new-privileges",
        "--read-only",
        "--tmpfs", "/tmp:rw,size=32m",
        "-v", `${this.dir}:/work`,
        "-w", "/work",
        "--user", "1000:1000",
        this.image,
        "bash", "-c", script,
      ],
      { timeoutMs: 60000 },
    );
    let stderr = "";
    let rc = r.code === 0 ? -1 : 1;
    try {
      stderr = readText(join(this.dir, "compile.err"));
      rc = parseInt(readText(join(this.dir, "compile.rc")).trim() || "1", 10);
    } catch {
      stderr = r.stderr;
    }
    return { ok: rc === 0 && !r.timedOut, stderr, durationMs: r.durationMs };
  }

  async run(exeName: string, opts: RunOptions): Promise<RunResult> {
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(opts.env ?? {})) envArgs.push("-e", `${k}=${v}`);
    const r = await this.docker(
      [
        "run", "--rm", "-i",
        "--network=none",
        `--memory=${Math.max(opts.memoryLimitMb, 64)}m`,
        "--cpus=1",
        "--pids-limit=128",
        "--security-opt=no-new-privileges",
        "-v", `${this.dir}:/work`,
        "-w", "/work",
        ...envArgs,
        this.image,
        `./${exeName}`,
      ],
      { input: opts.input, timeoutMs: opts.timeLimitMs },
    );
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.code,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
    };
  }

  cleanup(): void {
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

import { readFileSync } from "node:fs";
function readText(p: string): string {
  return readFileSync(p, "utf8");
}

export function createSandbox(): Sandbox {
  if (process.env.AUTOPSY_SANDBOX === "docker") {
    return new DockerSandbox();
  }
  return new LocalSandbox();
}
