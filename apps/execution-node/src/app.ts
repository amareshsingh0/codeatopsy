import Fastify from "fastify";
import { JobRequest } from "@codeautopsy/schemas";
import { DuplicateJobError, QueueFullError } from "./jobs";
import { createJobService, type JobService } from "./job-service";

export function createApp(service: JobService = createJobService()) {
  const secret = process.env.AUTOPSY_NODE_SECRET;
  if (process.env.NODE_ENV === "production" && !secret)
    throw new Error("AUTOPSY_NODE_SECRET is required in production");
  const app = Fastify({
    logger: { level: process.env.AUTOPSY_LOG_LEVEL || "warn" },
    bodyLimit: 8 * 1024 * 1024,
  });
  app.addHook("onReady", () => service.start());
  app.addHook("onClose", () => service.close());
  app.addHook("onRequest", async (req, reply) => {
    if (secret && req.headers["x-autopsy-secret"] !== secret)
      return reply.code(401).send({ error: "unauthorized" });
  });
  app.get("/health", async () => ({
    ok: true,
    sandbox: process.env.AUTOPSY_SANDBOX ?? "local",
    queue: service.kind,
    version: "1.0.0",
    ...(await service.stats()),
  }));
  app.post("/jobs", async (req, reply) => {
    const parsed = JobRequest.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid job", details: parsed.error.flatten() });
    if (
      parsed.data.language &&
      parsed.data.language !== parsed.data.problem.language &&
      parsed.data.problem.referenceSource.trim()
    ) {
      return reply.code(400).send({ error: "language must match the reference solution" });
    }
    try {
      const rec = await service.enqueue(parsed.data);
      return reply.code(202).send({ jobId: rec.jobId, status: rec.status });
    } catch (err) {
      if (err instanceof QueueFullError)
        return reply.header("retry-after", "5").code(503).send({ error: err.message });
      if (err instanceof DuplicateJobError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });
  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const rec = await service.get(req.params.id);
    return rec
      ? reply.header("cache-control", "no-store").send(rec)
      : reply.code(404).send({ error: "unknown job" });
  });
  return app;
}
