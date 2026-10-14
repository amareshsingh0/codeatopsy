import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { Problem } from "@codeautopsy/schemas";
const runner = vi.hoisted(() => vi.fn());
vi.mock("../src/pipeline", () => ({ processJob: runner }));
let jobs: typeof import("../src/jobs");
let appModule: typeof import("../src/app");
const problem = Problem.parse({
  slug: "playground",
  title: "Run",
  difficulty: "easy",
  blurb: "",
  statement: "",
  language: "javascript",
  referenceSource: "",
  studentSource: "",
  tests: [{ id: "t", input: "", expectedOutput: "" }],
});
const job = (jobId: string) => ({ jobId, problem, source: "console.log(1)", autopsy: true });
beforeAll(async () => {
  vi.stubEnv("AUTOPSY_MAX_JOBS", "2");
  vi.stubEnv("AUTOPSY_CONCURRENCY", "1");
  vi.stubEnv("AUTOPSY_CALLBACK_URL", "");
  jobs = await import("../src/jobs");
  appModule = await import("../src/app");
});
afterAll(() => vi.unstubAllEnvs());
describe("bounded worker queue", () => {
  it("limits concurrency and queue size, supports idempotence, and drains pending work", async () => {
    const done: Array<(value: unknown) => void> = [];
    runner.mockImplementation(() => new Promise((resolve) => done.push(resolve)));
    const first = jobs.enqueueJob(job("one"));
    jobs.enqueueJob(job("two"));
    expect(() => jobs.enqueueJob(job("three"))).toThrow(jobs.QueueFullError);
    expect(jobs.enqueueJob(job("one"))).toBe(first);
    expect(() => jobs.enqueueJob({ ...job("one"), source: "different" })).toThrow(jobs.DuplicateJobError);
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    expect(jobs.queueStats()).toMatchObject({ active: 1, queued: 1 });
    done.shift()!({ ok: true });
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
    done.shift()!({ ok: true });
    await vi.waitFor(() => expect(jobs.getJob("two")?.status).toBe("completed"));
    expect(jobs.getJob("one")?.completedAt).toBeTruthy();
    expect(jobs.queueStats()).toMatchObject({ active: 0, queued: 0 });
  });
  it("authenticates the worker, validates jobs, and creates no sandbox for health checks", async () => {
    vi.stubEnv("AUTOPSY_NODE_SECRET", "test-auth");
    const app = appModule.createApp();
    try {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(401);
      const headers = { "x-autopsy-secret": "test-auth" };
      expect((await app.inject({ method: "GET", url: "/health", headers })).statusCode).toBe(200);
      expect(
        (await app.inject({ method: "POST", url: "/jobs", headers, payload: { ...job("../escape") } }))
          .statusCode,
      ).toBe(400);
      expect((await app.inject({ method: "GET", url: "/jobs/unknown", headers })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
