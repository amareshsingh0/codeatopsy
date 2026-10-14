import assert from "node:assert/strict";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
async function request(path, body) {
  const response = await fetch(base + path, {
    ...(body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  assert(response.ok, `HTTP ${response.status}: ${data.error ?? path}`);
  return data;
}
async function execute(body) {
  const { id } = await request("/api/submissions", body);
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const submission = await request(`/api/submissions/${id}`);
    assert.notEqual(submission.status, "failed", submission.result?.error);
    if (submission.status === "completed") return submission.result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Submission ${id} did not finish in 120 seconds`);
}

const cases = [
  ["cpp", "#include <iostream>\nint main(){int x=40; if(true) x+=2; std::cout<<x;}"],
  ["c", '#include <stdio.h>\nint main(void){int x=42; printf("%d",x);return 0;}'],
  ["python", "a = [40]\na[0] += 2\nprint(a[0])"],
  [
    "javascript",
    'import fs from "node:fs"; const x=await Promise.resolve(fs.readFileSync(0,"utf8").trim()); console.log(x);',
  ],
  ["java", "public class Main { public static void main(String[] args) { System.out.println(42); } }"],
];
for (const [language, source] of cases) {
  const result = await execute({
    problemId: "playground",
    language,
    source,
    input: "42\n",
    expectedOutput: "42",
  });
  assert.equal(result.compileError, null);
  assert.equal(result.verdicts[0].status, "accepted", result.verdicts[0].detail);
  assert.equal(result.verdicts[0].output.trim(), "42");
  if (language !== "java")
    assert(result.studentTraces["run-1"]?.events.length > 0, `${language} trace missing`);
  console.log(`[smoke] ${language}: output, verdict${language !== "java" ? ", trace" : ""} passed`);
}
const { problems } = await request("/api/problems");
const demo = problems.find((problem) => problem.slug === "binary-search");
assert(demo, "Binary-search problem missing");
assert.equal(demo.referenceSource, undefined);
assert(demo.tests.filter((t) => t.hidden).every((t) => t.input === "" && t.expectedOutput === ""));
const autopsy = await execute({ problemId: demo.slug, source: demo.studentSource });
assert.equal(autopsy.report.divergence.kind, "control");
assert(autopsy.report.hypotheses.some((h) => h.id === "off-by-one-guard"));
const leftValues = autopsy.studentTraces.t1.events
  .filter((e) => e.kind === "assign" && e.name === "left")
  .map((e) => e.value);
assert.deepEqual(leftValues, ["0", "4", "6"]);
console.log("[smoke] library: hidden-test privacy, result polling, variable state and diagnosis passed");
const badCompile = await execute({ problemId: "playground", language: "cpp", source: "int main(" });
assert(badCompile.compileError?.stderr);
const badRuntime = await execute({
  problemId: "playground",
  language: "javascript",
  source: 'throw new Error("smoke failure")',
});
assert.equal(badRuntime.verdicts[0].status, "runtime_error");
console.log("[smoke] compiler and runtime error reporting passed");
