import { afterEach, describe, expect, it, vi } from "vitest";
import { submissionSession } from "../src/lib/submission-access";
afterEach(() => vi.unstubAllEnvs());
describe("private submission sessions", () => {
  it("retains signed ownership and rejects tampering", () => {
    vi.stubEnv("AUTOPSY_NODE_SECRET", "public-test-fixture-only-32-characters");
    const created = submissionSession(new Request("https://codeautopsy.test"));
    expect(created.valid).toBe(false);
    expect(created.cookie).toContain("HttpOnly; Secure; SameSite=Lax");
    const cookie = created.cookie.split(";")[0];
    const returned = submissionSession(new Request("https://codeautopsy.test", { headers: { cookie } }));
    expect(returned.valid).toBe(true);
    expect(returned.ownerHash).toBe(created.ownerHash);
    const last = cookie.at(-1) === "0" ? "1" : "0";
    const tampered = submissionSession(
      new Request("https://codeautopsy.test", { headers: { cookie: cookie.slice(0, -1) + last } }),
    );
    expect(tampered.valid).toBe(false);
    expect(tampered.ownerHash).not.toBe(created.ownerHash);
  });
});
