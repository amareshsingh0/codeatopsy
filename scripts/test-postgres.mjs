import EmbeddedPostgres from "embedded-postgres";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
const directory = await mkdtemp(join(tmpdir(), "autopsy-postgres-"));
const password = randomUUID();
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
const database = new EmbeddedPostgres({
  databaseDir: join(directory, "cluster"),
  user: "postgres",
  password,
  port,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});
const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
try {
  await database.initialise();
  await database.start();
  const cli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  const child = spawn(process.execPath, [cli, "run", "tests/job-queue.integration.test.ts"], {
    cwd: new URL("../packages/db", import.meta.url),
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      AUTOPSY_TEST_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`,
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await database.stop();
}
