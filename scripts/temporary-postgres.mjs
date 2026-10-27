import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, unlink, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

// Use the package's published native binaries, with explicit bounded lifecycle control.
export async function temporaryPostgres() {
  if (process.getuid?.() === 0)
    throw new Error(
      "Run temporary Postgres tests as a non-root user, or supply AUTOPSY_TEST_DATABASE_URL to the integration suite.",
    );
  const binaryRequire = createRequire(import.meta.resolve("embedded-postgres"));
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const binaries = await import(
    pathToFileURL(binaryRequire.resolve(`@embedded-postgres/${platform}-${process.arch}`)).href
  );
  const root = await mkdtemp(join(tmpdir(), "autopsy-test-db-"));
  if (process.platform !== "win32") {
    await chmod(binaries.initdb, 0o755);
    await chmod(binaries.pg_ctl, 0o755);
  }
  const directory = join(root, "cluster");
  const passwordFile = join(root, "test-password");
  const password = randomUUID();
  const port = await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port;
      server.close(() => resolvePort(value));
    });
  });
  const run = (program, args, timeout = 15000) =>
    new Promise((resolveRun, reject) => {
      const child = spawn(program, args, { windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            `Temporary Postgres ${program.endsWith("initdb.exe") || program.endsWith("initdb") ? "initialization" : "control"} command exceeded its budget`,
          ),
        );
      }, timeout);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolveRun();
        else reject(new Error(`Temporary Postgres lifecycle command failed (${code})`));
      });
    });
  let started = false;
  const stop = async () => {
    if (started) {
      await run(binaries.pg_ctl, ["-D", directory, "-m", "fast", "-w", "-t", "10", "stop"]);
      started = false;
    }
    const target = resolve(root);
    const allowed = resolve(tmpdir()) + sep;
    if (!target.startsWith(allowed) || !target.includes("autopsy-test-db-"))
      throw new Error("Temporary database cleanup target failed validation");
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  try {
    await writeFile(passwordFile, password, { mode: 0o600 });
    await run(
      binaries.initdb,
      [
        "-D",
        directory,
        "--username=postgres",
        "--auth=scram-sha-256",
        `--pwfile=${passwordFile}`,
        "--encoding=UTF8",
        "--locale=C",
        "--no-sync", // Disposable fixtures only; avoid slow durable disk flushes in tests.
      ],
      60000,
    );
    await unlink(passwordFile);
    await run(binaries.pg_ctl, [
      "-D",
      directory,
      "-o",
      `-h 127.0.0.1 -p ${port}`,
      "-l",
      join(root, "postgres.log"),
      "-w",
      "-t",
      "10",
      "start",
    ]);
    started = true;
    return { url: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`, stop };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}
