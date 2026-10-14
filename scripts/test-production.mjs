import { temporaryPostgres } from "./temporary-postgres.mjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const dbRequire = createRequire(join(root, "packages/db/package.json"));
const webRequire = createRequire(join(root, "apps/web/package.json"));
const postgres = dbRequire("postgres");
const port = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
const [workerPort, webPort] = await Promise.all([port(), port()]);
const secret = randomUUID();
const database = await temporaryPostgres();
const children = [];
let sql;
function launch(cwd, args, env) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => (logs = (logs + chunk).slice(-8000)));
  child.stderr.on("data", (chunk) => (logs = (logs + chunk).slice(-8000)));
  child.on("error", (error) => (logs += error.message));
  children.push(child);
  return { child, logs: () => logs };
}
async function stop(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32")
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}
async function ready(url, options = {}) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(1500) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Production smoke service did not become ready");
}
try {
  const url = database.url;
  sql = postgres(url, { prepare: false });
  await sql.unsafe(await readFile(join(root, "packages/db/migrations/001_execution_jobs.sql"), "utf8"));
  const env = {
    NODE_ENV: "production",
    DATABASE_URL: url,
    AUTOPSY_NODE_SECRET: secret,
    AUTOPSY_SANDBOX: "local",
    AUTOPSY_ALLOW_LOCAL_EXECUTION: "true",
    AUTOPSY_CALLBACK_URL: "",
    EXECUTION_NODE_URL: `http://127.0.0.1:${workerPort}`,
  };
  const worker = launch(join(root, "apps/execution-node"), ["dist/server.cjs"], {
    ...env,
    PORT: String(workerPort),
  });
  const web = launch(
    join(root, "apps/web"),
    [webRequire.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
    env,
  );
  await ready(`http://127.0.0.1:${workerPort}/health`, { headers: { "x-autopsy-secret": secret } });
  await ready(`http://127.0.0.1:${webPort}/api/problems`);
  const smoke = spawn(process.execPath, [join(root, "scripts/smoke.mjs"), `http://127.0.0.1:${webPort}`], {
    cwd: root,
    windowsHide: true,
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    smoke.on("exit", resolve);
    smoke.on("error", reject);
  });
  if (code !== 0) {
    console.error(worker.logs());
    console.error(web.logs());
    throw new Error("Production HTTP smoke failed");
  }
  const [count] = await sql`select count(*)::int as count from submissions where status = 'completed'`;
  if (count.count < 8) throw new Error("Durable results were not persisted");
  console.log(
    `[production smoke] ${count.count} completed results persisted in Postgres through the durable worker queue`,
  );
} finally {
  await Promise.all(children.map(stop));
  if (sql) await sql.end();
  await database.stop();
}
