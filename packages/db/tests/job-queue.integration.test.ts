import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PostgresJobQueue, JobConflictError, QueueCapacityError } from "../src/job-queue";
import { Problem } from "@codeautopsy/schemas";
const url = process.env.AUTOPSY_TEST_DATABASE_URL;
// Requires a disposable test database. This suite never uses the production DATABASE_URL.
describe.skipIf(!url)("Postgres queue integration", () => {
  const schema = `autopsy_test_${randomUUID().replaceAll("-", "")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let queue: PostgresJobQueue;
  const problem = Problem.parse({
    slug: "playground",
    title: "Test",
    blurb: "",
    statement: "",
    difficulty: "easy",
    language: "javascript",
    studentSource: "",
    referenceSource: "",
    tests: [{ id: "t", input: "", expectedOutput: "" }],
  });
  const job = (id: string) => ({ jobId: id, source: "console.log(1)", problem, autopsy: true });
  beforeAll(async () => {
    admin = postgres(url!, { prepare: false });
    await admin`create schema ${admin(schema)}`;
    sql = postgres(url!, { prepare: false, connection: { search_path: schema } });
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
    queue = new PostgresJobQueue(sql, 2, 60, 3, schema);
    await queue.assertReady();
  });
  afterAll(async () => {
    if (sql) await sql.end();
    if (admin) {
      await admin`drop schema ${admin(schema)} cascade`;
      await admin.end();
    }
  });
  it("enforces shared capacity, idempotence and distinct concurrent claims", async () => {
    await queue.enqueue(job("a"));
    await queue.enqueue(job("b"));
    expect((await queue.enqueue(job("a"))).jobId).toBe("a");
    await expect(queue.enqueue({ ...job("a"), source: "different" })).rejects.toBeInstanceOf(
      JobConflictError,
    );
    await expect(queue.enqueue(job("c"))).rejects.toBeInstanceOf(QueueCapacityError);
    const [a, b] = await Promise.all([queue.claim(), queue.claim()]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.jobId).not.toBe(b!.jobId);
    expect(await queue.claim()).toBeNull();
  });
  it("recovers expired leases and fences stale terminal writes", async () => {
    await sql`update ${sql(schema + ".execution_jobs")} set lease_until = now() - interval '1 second' where id = 'a'`;
    const lease = await queue.claim();
    expect(lease?.jobId).toBe("a");
    expect(await queue.finish({ ...lease!, token: "stale-token" }, null, "stale")).toBe(false);
    expect(await queue.renew(lease!)).toBe(true);
    expect(await queue.finish(lease!, null, "test failure")).toBe(true);
    expect((await queue.get("a"))?.status).toBe("failed");
    expect(await queue.finish(lease!, null, "late failure")).toBe(false);
    await queue.enqueue(job("c"));
    expect((await queue.get("c"))?.status).toBe("queued");
    const unicodeJob = { ...job("unicode"), source: 'print("→ ✓ café")' };
    await new PostgresJobQueue(sql, 10, 60, 3, schema).enqueue(unicodeJob);
    expect((await queue.get("unicode"))?.jobId).toBe("unicode");
    const [saved] =
      await sql`select payload->>'source' as source from ${sql(schema + ".execution_jobs")} where id = 'unicode'`;
    expect(saved.source).toBe(unicodeJob.source);
  });
});
