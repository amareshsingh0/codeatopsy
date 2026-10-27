import { temporaryPostgres } from "./temporary-postgres.mjs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
const database = await temporaryPostgres();
const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
try {
  const cli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  const child = spawn(
    process.execPath,
    [cli, "run", "tests/job-queue.integration.test.ts", "tests/sandbox-jobs.integration.test.ts"],
    {
      cwd: new URL("../packages/db", import.meta.url),
      windowsHide: true,
      stdio: "inherit",
      env: {
        ...process.env,
        AUTOPSY_TEST_DATABASE_URL: database.url,
      },
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await database.stop();
}
