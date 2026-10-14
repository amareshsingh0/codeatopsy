import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, getStore, emptyFailure } from "@codeautopsy/db";
import { POST } from "../src/app/api/submissions/route";
import { GET } from "../src/app/api/submissions/[id]/route";
import { POST as callback } from "../src/app/api/internal/execution-callback/route";
import { getFullProblem, toPublic } from "../src/lib/problems";

vi.mock("@codeautopsy/db", async (load) => ({
  ...(await load<typeof import("@codeautopsy/db")>()),
  getStore: vi.fn(),
}));
let dir: string;
let store: FileStore;
const completed = { ...emptyFailure(""), ok: true };
const request = (body: unknown) =>
  new Request("http://localhost/api/submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ca-web-test-"));
  store = new FileStore(join(dir, "submissions.json"));
  vi.mocked(getStore).mockReturnValue(store);
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});
describe("submission HTTP boundary", () => {
  it("omits the reference solution and hidden test contents from browser problem payloads", () => {
    const problem = getFullProblem("binary-search")!;
    const publicProblem = toPublic(problem);
    expect(publicProblem).not.toHaveProperty("referenceSource");
    expect(
      publicProblem.tests
        .filter((test) => test.hidden)
        .every((test) => test.input === "" && test.expectedOutput === ""),
    ).toBe(true);
    expect(getFullProblem("../outside")).toBeNull();
  });
  it.each([
    null,
    [],
    { problemId: 1, source: "x" },
    { problemId: "../outside", source: "x" },
    { problemId: "playground", source: "x", language: "unknown" },
    { problemId: "playground", source: "x", input: "x".repeat(100001) },
  ])("rejects malformed requests without throwing: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  });
  it("submits a standalone job and recovers the finished result without a callback", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const created = await POST(
      request({ problemId: "playground", source: 'console.log("ok")', language: "javascript" }),
    );
    expect(created.status).toBe(202);
    const { id } = await created.json();
    fetch.mockResolvedValueOnce(Response.json({ jobId: id, status: "completed", result: completed }));
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
    const sub = await response.json();
    expect(sub.status).toBe("completed");
    expect(sub.result.ok).toBe(true);
    expect((await new FileStore(join(dir, "submissions.json")).get(id))?.status).toBe("completed");
  });
  it("keeps transient worker outages retryable and records jobs lost after a restart", async () => {
    await store.create({ id: "s1", problemId: "p", source: "x" });
    const fetch = vi.fn().mockRejectedValueOnce(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetch);
    const context = { params: Promise.resolve({ id: "s1" }) };
    expect((await GET(new Request("http://localhost"), context)).status).toBe(503);
    expect((await store.get("s1"))?.status).toBe("queued");
    fetch.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const response = await GET(new Request("http://localhost"), context);
    expect((await response.json()).status).toBe("failed");
  });
  it("validates callbacks without crashing or replacing terminal results", async () => {
    expect((await callback(request(null))).status).toBe(400);
    await store.create({ id: "s1", problemId: "p", source: "x" });
    expect((await callback(request({ submissionId: "s1", status: "completed", result: {} }))).status).toBe(
      400,
    );
    expect(
      (await callback(request({ submissionId: "s1", status: "completed", result: completed }))).status,
    ).toBe(200);
    expect((await callback(request({ submissionId: "s1", status: "failed", error: "late" }))).status).toBe(
      200,
    );
    expect((await store.get("s1"))?.status).toBe("completed");
  });
});
