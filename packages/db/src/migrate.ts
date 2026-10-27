import postgres from "postgres";

/** Release tooling only: caller supplies the checked-in migration, never HTTP SQL. */
export async function applyPrivateMigration(migration: string) {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(?:ql)?:\/\//.test(url)) throw new Error("Postgres URI is required");
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    await sql.unsafe(migration);
    const [row] =
      await sql`select count(*)::int as count from information_schema.tables where table_schema='codeautopsy' and table_name in ('submissions','execution_jobs','submission_access','sandbox_runs')`;
    return { ready: row.count === 4, tables: row.count, schema: "codeautopsy" };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
