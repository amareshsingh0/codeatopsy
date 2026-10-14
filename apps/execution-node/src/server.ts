import { createApp } from "./app";
import { pruneJobs } from "./jobs";
import { createSandbox } from "./sandbox";

const app = createApp();
setInterval(pruneJobs, 10 * 60 * 1000).unref();
async function start() {
  const sandbox = createSandbox();
  sandbox.cleanup();
  const port = Number(process.env.PORT || process.env.AUTOPSY_PORT || "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid execution node port");
  await app.listen({ port, host: process.env.AUTOPSY_HOST || "127.0.0.1" });
  console.log(`[execution-node] listening on :${port} (sandbox=${sandbox.kind})`);
}
void start().catch((err) => {
  app.log.error(err);
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
export default app;
