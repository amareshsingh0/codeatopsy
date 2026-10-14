import { afterEach, describe, expect, it } from "vitest";
import { LocalSandbox, createSandbox } from "../src/sandbox";

let sandbox: LocalSandbox;
afterEach(() => sandbox?.cleanup());
describe("local sandbox process lifecycle", () => {
  it("supports synchronous stdin and excludes worker credentials from child environments", async () => {
    sandbox = new LocalSandbox();
    process.env.AUTOPSY_NODE_SECRET = "test-only-marker";
    try {
      const r = await sandbox.exec(
        [
          process.execPath,
          "-e",
          'console.log(require("fs").readFileSync(0,"utf8")); console.log(process.env.AUTOPSY_NODE_SECRET ?? "absent")',
        ],
        { input: "stdin value", timeoutMs: 10000 },
      );
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("stdin value");
      expect(r.stdout).toContain("absent");
      expect(r.stdout).not.toContain("test-only-marker");
    } finally {
      delete process.env.AUTOPSY_NODE_SECRET;
    }
  });
  it("bounds output and terminates programs exceeding the wall-clock budget", async () => {
    sandbox = new LocalSandbox();
    const flooded = await sandbox.exec(
      [process.execPath, "-e", 'process.stdout.write("x".repeat(400000)); setInterval(()=>{},1000)'],
      { timeoutMs: 10000 },
    );
    expect(flooded.outputLimitExceeded).toBe(true);
    expect(flooded.stdout.length).toBeLessThanOrEqual(256 * 1024);
    const loop = await sandbox.exec([process.execPath, "-e", "while(true){}"], { timeoutMs: 300 });
    expect(loop.timedOut).toBe(true);
  });
  it("reports missing tools and rejects filename traversal", async () => {
    sandbox = new LocalSandbox();
    const missing = await sandbox.exec(["codeautopsy-nonexistent-tool"], { timeoutMs: 1000 });
    expect(missing.exitCode).toBeNull();
    expect(missing.stderr).toContain("ENOENT");
    expect(() => sandbox.writeFile("../escape", "bad")).toThrow();
  });
  it("fails closed on an unknown sandbox mode", () => {
    process.env.AUTOPSY_SANDBOX = "typo";
    try {
      expect(() => createSandbox()).toThrow("Unknown AUTOPSY_SANDBOX");
    } finally {
      delete process.env.AUTOPSY_SANDBOX;
    }
  });
});
