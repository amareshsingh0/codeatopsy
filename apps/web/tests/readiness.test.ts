import { afterEach, describe, expect, it, vi } from "vitest";
import { configurationIssue } from "../src/lib/readiness";
import { GET } from "../src/app/api/health/route";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("production readiness", () => {
  it("reports absent production infrastructure without exposing connection values", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTOPSY_ALLOW_FILE_STORE", "");
    expect(configurationIssue()).toContain("persistent database");
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).ready).toBe(false);
  });
  it("does not label an unisolated or memory-queued worker ready for production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://configured");
    vi.stubEnv("EXECUTION_NODE_URL", "https://worker.example");
    vi.stubEnv("AUTOPSY_NODE_SECRET", "test-only-auth");
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, sandbox: "local", queue: "memory" }));
    vi.stubGlobal("fetch", fetch);
    expect((await GET()).status).toBe(503);
    fetch.mockResolvedValue(Response.json({ ok: true, sandbox: "docker", queue: "postgres" }));
    expect((await GET()).status).toBe(200);
  });
});
