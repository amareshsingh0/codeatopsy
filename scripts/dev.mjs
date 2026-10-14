import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const children = [];
let stopping = false;
async function availablePort(preferred) {
  if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535)
    throw new Error("Invalid development port");
  for (let port = preferred; port <= Math.min(65535, preferred + 20); port++) {
    const free = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", (err) => (err.code === "EADDRINUSE" ? resolve(false) : reject(err)));
      probe.listen({ host: "127.0.0.1", port }, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No development port available near ${preferred}`);
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => child.kill());
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already stopped */
      }
    }
  }
  setTimeout(() => process.exit(code), 500);
}
function launch(app, module, args, env) {
  const cwd = join(root, "apps", app);
  const require = createRequire(join(cwd, "package.json"));
  const child = spawn(process.execPath, [require.resolve(module), ...args], {
    cwd,
    env: { ...process.env, ...env, NODE_ENV: "development" },
    stdio: "inherit",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  children.push(child);
  child.once("error", (err) => {
    console.error(`[dev] ${app}: ${err.message}`);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`[dev] ${app} stopped (${code ?? "signal"})`);
      stop(code || 1);
    }
  });
}
async function main() {
  const workerPort = await availablePort(Number(process.env.AUTOPSY_PORT || 8787));
  const webPort = await availablePort(Number(process.env.AUTOPSY_WEB_PORT || 3000));
  const workerURL = `http://127.0.0.1:${workerPort}`;
  const webURL = `http://127.0.0.1:${webPort}`;
  console.log(`[dev] Web: ${webURL} · Worker: ${workerURL}`);
  // Run directly so a startup failure exits instead of leaving a watch process alive.
  launch("execution-node", "tsx/cli", ["src/server.ts"], { AUTOPSY_PORT: String(workerPort), PORT: "" });
  launch("web", "next/dist/bin/next", ["dev", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    EXECUTION_NODE_URL: workerURL,
    AUTOPSY_NEXT_DIST_DIR: `.next-local-${webPort}`,
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
void main().catch((err) => {
  console.error(`[dev] ${err.message}`);
  stop(1);
});
