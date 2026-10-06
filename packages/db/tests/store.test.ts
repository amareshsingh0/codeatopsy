import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, getStore, emptyFailure } from "../src/index";

let dir: string;
let store: FileStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ca-db-"));
  store = new FileStore(join(dir, "submissions.json"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("FileStore", () => {
  it("creates, reads, updates submissions with persistence", async () => {
    await store.create({ id: "s1", problemId: "binary-search", source: "int main(){}" });
    const s = await store.get("s1");
    expect(s?.status).toBe("queued");

    await store.setStatus("s1", "running");
    await store.complete("s1", {
      ok: true,
      compileError: null,
      verdicts: [{ testId: "t1", status: "accepted", exitCode: 0, durationMs: 2 }],
      studentTraces: {},
      referenceTraces: {},
      report: null,
    });

    // new instance reads persisted state
    const store2 = new FileStore(join(dir, "submissions.json"));
    const s2 = await store2.get("s1");
    expect(s2?.status).toBe("completed");
    expect(s2?.result?.ok).toBe(true);
    expect(s2?.completedAt).toBeTruthy();
  });

  it("records failures", async () => {
    await store.create({ id: "s2", problemId: "p", source: "x" });
    await store.fail("s2", "boom");
    const s = await store.get("s2");
    expect(s?.status).toBe("failed");
    expect(s?.result?.error).toBe("boom");
    expect(emptyFailure("x").ok).toBe(false);
  });

  it("lists newest first", async () => {
    await store.create({ id: "a", problemId: "p", source: "x" });
    await store.create({ id: "b", problemId: "p", source: "x" });
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("getStore", () => {
  it("falls back to the file store without DATABASE_URL", () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(getStore().kind).toBe("file");
    } finally {
      if (prev) process.env.DATABASE_URL = prev;
    }
  });
});
