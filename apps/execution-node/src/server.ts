/**
 * Execution node — a small Fastify service the web API delegates execution to.
 *
 *   POST /jobs        enqueue an execution job (validated JobRequest)
 *   GET  /jobs/:id    poll job status/result
 *   GET  /health      liveness + provider info
 *
 * Auth: when AUTOPSY_NODE_SECRET is set, all routes require `x-autopsy-secret`.
 */
import Fastify from "fastify";
import { JobRequest } from "@codeautopsy/schemas";
import { enqueueJob, getJob, newId, registerPayload, pruneJobs } from "./jobs";
import { createSandbox } from "./sandbox";

const app = Fastify({ logger: { level: process.env.AUTOPSY_LOG_LEVEL || "warn" }, bodyLimit: 8 * 1024 * 1024 });
const PORT = Number(process.env.AUTOPSY_PORT || "8787");
const SECRET = process.env.AUTOPSY_NODE_SECRET;

app.addHook("onRequest", async (req, reply) => {
  if (!SECRET) return;
  if (req.headers["x-autopsy-secret"] !== SECRET) {
    await reply.code(401).send({ error: "unauthorized" });
  }
});

setInterval(pruneJobs, 10 * 60 * 1000).unref();

app.get("/health", async () => ({
  ok: true,
  sandbox: createSandbox().kind,
  version: "1.0.0",
}));

app.post("/jobs", async (req, reply) => {
  const parsed = JobRequest.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid job", details: parsed.error.flatten() });
  }
  const jobId = parsed.data.jobId || newId();
  const job = { ...parsed.data, jobId };
  registerPayload(job);
  const rec = enqueueJob(job);
  return reply.code(202).send({ jobId: rec.jobId, status: rec.status });
});

app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
  const rec = getJob(req.params.id);
  if (!rec) return reply.code(404).send({ error: "unknown job" });
  return {
    jobId: rec.jobId,
    status: rec.status,
    result: rec.result,
    error: rec.error,
    createdAt: rec.createdAt,
    completedAt: rec.completedAt,
  };
});

const start = async () => {
  try {
    await app.listen({ port: PORT, host: process.env.AUTOPSY_HOST || "127.0.0.1" });
    console.log(`[execution-node] listening on :${PORT} (sandbox=${createSandbox().kind})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
void start();

export default app;
