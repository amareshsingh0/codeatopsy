import { readFile } from "node:fs/promises";
const base = process.env.AUTOPSY_WEB_URL || "http://127.0.0.1:3000";
const source = await readFile(new URL("../apps/web/src/lib/examples.ts", import.meta.url), "utf8");
const examples = [
  ...source.matchAll(
    /python\("([^"]+)",\s*"[^"]+",\s*"[^"]+",\s*"[^"]+",\s*("(?:[^"\\]|\\.)*"),\s*("(?:[^"\\]|\\.)*")\)/g,
  ),
].map((match) => ({ slug: match[1], source: JSON.parse(match[2]), expectedOutput: JSON.parse(match[3]) }));
if (examples.length !== 20) throw new Error(`Expected 20 examples, parsed ${examples.length}`);
let cookie = "";
for (const example of examples) {
  const response = await fetch(`${base}/api/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({
      problemId: "playground",
      language: "python",
      source: example.source,
      expectedOutput: example.expectedOutput,
    }),
    signal: AbortSignal.timeout(90000),
  });
  cookie = response.headers.get("set-cookie")?.split(";")[0] || cookie;
  const body = await response.json();
  if (response.status !== 202) throw new Error(`${example.slug}: ${body.error}`);
  const started = Date.now();
  let submission;
  do {
    if (Date.now() - started > 120000) throw new Error(`${example.slug}: polling exceeded budget`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const poll = await fetch(`${base}/api/submissions/${body.id}`, {
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(90000),
    });
    if (!poll.ok) throw new Error(`${example.slug}: poll ${poll.status}`);
    submission = await poll.json();
  } while (!["completed", "failed"].includes(submission.status));
  const verdict = submission.result?.verdicts?.[0];
  const expected =
    example.slug === "diagnostics"
      ? "runtime_error"
      : example.slug === "divergence"
        ? "wrong_answer"
        : "accepted";
  if (verdict?.status !== expected)
    throw new Error(`${example.slug}: expected ${expected}, got ${verdict?.status}`);
  if (!Object.keys(submission.result.studentTraces).length)
    throw new Error(`${example.slug}: no recorded trace`);
  console.log(
    `${example.slug}: ${verdict.status}, ${submission.result.studentTraces["run-1"].events.length} events`,
  );
}
