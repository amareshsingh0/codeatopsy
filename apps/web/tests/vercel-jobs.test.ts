import { beforeEach, describe, expect, it, vi } from "vitest";
import { Problem } from "@codeautopsy/schemas";
const mocks = vi.hoisted(() => ({
  store: { claim: vi.fn(), get: vi.fn(), started: vi.fn(), finish: vi.fn(), assertReady: vi.fn() },
  get: vi.fn(),
  create: vi.fn(),
  snapshot: vi.fn(),
  APIError: class extends Error {
    constructor(public response: { status: number }) {
      super("API error");
    }
  },
}));
vi.mock("@codeautopsy/db", () => ({ getSandboxJobs: () => mocks.store }));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: { get: mocks.get, create: mocks.create },
  Snapshot: { get: mocks.snapshot },
  APIError: mocks.APIError,
}));
import { startSandboxJob, pollSandboxJob } from "../src/lib/vercel-jobs";

const problem = Problem.parse({
  slug: "playground",
  title: "Fixture",
  blurb: "",
  statement: "",
  difficulty: "easy",
  language: "javascript",
  studentSource: "",
  referenceSource: "",
  tests: [{ id: "t", input: "", expectedOutput: "1" }],
});
const run = {
  job_id: "id",
  sandbox_name: "ca-run-id",
  state: "starting",
  launch_token: "token",
  launch_until: new Date(Date.now() + 45000),
  deadline_at: new Date(Date.now() + 720000),
  payload: { jobId: "id", source: "console.log(1)", problem, autopsy: true },
  result: null,
  error: null,
};
const vm = () => ({
  status: "running",
  fs: { stat: vi.fn().mockRejectedValue({ code: "ENOENT" }), readFile: vi.fn() },
  runCommand: vi.fn(),
  delete: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.claim.mockResolvedValue(run);
});
describe("isolated cloud job recovery", () => {
  it("creates a bounded offline VM and passes only execution configuration", async () => {
    const sandbox = vm();
    mocks.get.mockRejectedValue(new mocks.APIError({ status: 404 }));
    mocks.create.mockResolvedValue(sandbox);
    await startSandboxJob("id");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        networkPolicy: "deny-all",
        persistent: false,
        timeout: 720000,
        resources: { vcpus: 1 },
      }),
    );
    expect(Object.keys(sandbox.runCommand.mock.calls[0][0].env).sort()).toEqual([
      "AUTOPSY_ISOLATED_VM",
      "AUTOPSY_SANDBOX",
      "AUTOPSY_VM_MEMORY_MB",
      "NODE_ENV",
    ]);
    expect(mocks.store.started).toHaveBeenCalledWith("id", "token");
  });
  it("recovers an existing started VM without executing code again", async () => {
    const sandbox = vm();
    sandbox.fs.stat.mockResolvedValue({ size: 1 });
    mocks.get.mockResolvedValue(sandbox);
    await startSandboxJob("id");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(sandbox.runCommand).not.toHaveBeenCalled();
    expect(mocks.store.started).toHaveBeenCalled();
  });
  it("records an actionable quota failure", async () => {
    mocks.get.mockRejectedValue(new mocks.APIError({ status: 404 }));
    mocks.create.mockRejectedValue(new mocks.APIError({ status: 429 }));
    await startSandboxJob("id");
    expect(mocks.store.finish).toHaveBeenCalledWith("id", null, expect.stringContaining("quota resets"));
  });
  it("persists a completed result before removing the VM", async () => {
    const sandbox = vm();
    const result = {
      ok: true,
      compileError: null,
      verdicts: [],
      studentTraces: {},
      referenceTraces: {},
      report: null,
    };
    sandbox.fs.stat.mockResolvedValue({ size: 100 });
    sandbox.fs.readFile.mockResolvedValue(JSON.stringify(result));
    mocks.get.mockResolvedValue(sandbox);
    mocks.store.get
      .mockResolvedValueOnce({ ...run, state: "running" })
      .mockResolvedValueOnce({ ...run, state: "completed", result });
    expect((await pollSandboxJob("id"))?.status).toBe("completed");
    expect(mocks.store.finish).toHaveBeenCalledWith("id", expect.objectContaining({ ok: true }));
    expect(sandbox.delete).toHaveBeenCalledOnce();
    expect(mocks.store.finish.mock.invocationCallOrder[0]).toBeLessThan(
      sandbox.delete.mock.invocationCallOrder[0],
    );
  });
});
