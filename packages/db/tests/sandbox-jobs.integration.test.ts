import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Problem } from "@codeautopsy/schemas";
import { SandboxJobs, AdmissionLimit } from "../src/sandbox-jobs";

const url = process.env.AUTOPSY_TEST_DATABASE_URL;
describe.skipIf(!url)("durable isolated VM scheduling", () => {
  const schema = `autopsy_vm_${randomUUID().replaceAll("-", "")}`;
  let sql: postgres.Sql;
  let store: SandboxJobs;
  const problem = Problem.parse({
    slug: "playground",
    title: "Test",
    blurb: "",
    statement: "",
    difficulty: "easy",
    language: "javascript",
    studentSource: "",
    referenceSource: "",
    tests: [{ id: "t", input: "", expectedOutput: "1" }],
  });
  const reserve = (id: string, address = "address") =>
    store.reserve(
      { jobId: id, source: "console.log(1)", problem, autopsy: true },
      "playground",
      "owner",
      address,
    );
  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, max: 8 });
    const migrator = postgres(url!, { prepare: false, max: 1 });
    try {
      await migrator.unsafe(
        readFileSync(
          new URL("../migrations/002_codeautopsy_private.sql", import.meta.url),
          "utf8",
        ).replaceAll("codeautopsy", schema),
      );
    } finally {
      await migrator.end();
    }
    store = new SandboxJobs(sql, schema);
    await store.assertReady();
  });
  beforeEach(async () => {
    await sql`truncate ${sql(schema + ".submissions")} cascade`;
  });
  afterAll(async () => {
    if (sql) {
      await sql`drop schema ${sql(schema)} cascade`;
      await sql.end();
    }
  });
  it("enforces ownership, concurrent capacity and launch leases", async () => {
    for (let i = 0; i < 4; i++) await reserve(String(i));
    expect(await store.owns("0", "owner")).toBe(true);
    expect(await store.owns("0", "other")).toBe(false);
    const claims = await Promise.all([0, 1, 2, 3].map((i) => store.claim(String(i))));
    expect(claims.filter(Boolean)).toHaveLength(3);
    const first = claims.find(Boolean)!;
    expect(await store.claim(first.job_id)).toBeNull();
    await store.started(first.job_id, "stale-token");
    expect((await store.get(first.job_id))?.state).toBe("starting");
    await sql`update ${sql(schema + ".sandbox_runs")} set launch_until=now()-interval '1 second' where job_id=${first.job_id}`;
    const recovered = await store.claim(first.job_id);
    expect(recovered?.launch_token).not.toBe(first.launch_token);
    await store.started(first.job_id, first.launch_token!);
    expect((await store.get(first.job_id))?.state).toBe("starting");
    await store.started(first.job_id, recovered!.launch_token!);
    expect((await store.get(first.job_id))?.state).toBe("running");
  });
  it("persists terminal failures once and clears execution payloads", async () => {
    await reserve("failure");
    await store.finish("failure", null, "Execution allowance reached.");
    await store.finish("failure", null, "A late write must not win.");
    const saved = await store.get("failure");
    expect(saved?.state).toBe("failed");
    expect(saved?.error).toBe("Execution allowance reached.");
    expect(saved?.result?.error).toBe("Execution allowance reached.");
    expect(saved?.payload).toBeNull();
  });
  it("rejects queue overflow atomically and expires stale work", async () => {
    const results = await Promise.allSettled(Array.from({ length: 31 }, (_, i) => reserve(String(i))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(30);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(
      AdmissionLimit,
    );
    await sql`update ${sql(schema + ".sandbox_runs")} set created_at=now()-interval '31 minutes'`;
    await reserve("fresh");
    const [count] =
      await sql`select count(*)::int as count from ${sql(schema + ".sandbox_runs")} where state='queued'`;
    expect(count.count).toBe(1);
    expect((await store.get("0"))?.state).toBe("failed");
  });
  it("enforces per-address allowance even after jobs complete", async () => {
    for (let i = 0; i < 50; i++) {
      await reserve(String(i));
      await store.finish(String(i), null, "fixture");
    }
    await expect(reserve("limited")).rejects.toBeInstanceOf(AdmissionLimit);
    await expect(reserve("another-address", "different")).resolves.toBeUndefined();
    expect(await store.owns("another-address", "owner")).toBe(true);
  });
});
