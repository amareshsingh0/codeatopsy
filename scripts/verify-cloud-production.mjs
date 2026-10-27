// Public synthetic fixtures only; never reads local application credentials.
const base = process.env.AUTOPSY_WEB_URL || "https://codeatopsy.vercel.app";
const cases = [
  [
    "cpp",
    '#include <iostream>\nint main(){int x;std::cin>>x;int y=x+2;std::cout<<y<<"\\n";}',
    "5\n",
    "7\n",
    "accepted",
  ],
  [
    "c",
    '#include <stdio.h>\nint main(){int x;scanf("%d",&x);int y=x+2;printf("%d\\n",y);}',
    "5\n",
    "7\n",
    "accepted",
  ],
  ["python", "x=int(input())\ny=x+2\nprint(y)", "5\n", "7\n", "accepted"],
  [
    "javascript",
    "const x=Number(require('fs').readFileSync(0,'utf8'));\nconst y=x+2;\nconsole.log(y);",
    "5\n",
    "7\n",
    "accepted",
  ],
  [
    "java",
    "import java.util.*;\nclass Main{public static void main(String[] a){int x=new Scanner(System.in).nextInt();System.out.println(x+2);}}",
    "5\n",
    "7\n",
    "accepted",
  ],
  ["javascript", "console.log(8)", "", "7\n", "wrong_answer"],
  ["cpp", "int main( {", "", "", "compile_error"],
  ["python", "raise ValueError('fixture')", "", "", "runtime_error"],
  ["javascript", "while(true){}", "", "", "timeout"],
];
const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(30000) });
if (!health.ok || !(await health.json()).ready) throw new Error("Execution readiness failed");
let cookie = "";
for (const [language, source, input, expectedOutput, expected] of cases) {
  const res = await fetch(`${base}/api/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ problemId: "playground", language, source, input, expectedOutput }),
    signal: AbortSignal.timeout(90000),
  });
  cookie = res.headers.get("set-cookie")?.split(";")[0] || cookie;
  const body = await res.json();
  if (res.status !== 202) throw new Error(`${language}: ${body.error}`);
  const anonymous = await fetch(`${base}/api/submissions/${body.id}`, { signal: AbortSignal.timeout(15000) });
  if (anonymous.status !== 404) throw new Error("Submission ownership check failed");
  let submission;
  const started = Date.now();
  do {
    if (Date.now() - started > 120000) throw new Error("Execution polling budget exceeded");
    const poll = await fetch(`${base}/api/submissions/${body.id}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(90000),
    });
    if (!poll.ok) throw new Error(`Status request failed (${poll.status})`);
    submission = await poll.json();
    if (!["completed", "failed"].includes(submission.status))
      await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!["completed", "failed"].includes(submission.status));
  const result = submission.result;
  const status = result?.compileError ? "compile_error" : result?.verdicts[0]?.status;
  if (status !== expected)
    throw new Error(`${language}: expected ${expected}, got ${status}; ${result?.error ?? ""}`);
  const events = result?.studentTraces?.["run-1"]?.events.length ?? 0;
  if (expected === "accepted" && language !== "java" && !events)
    throw new Error(`${language}: trace missing`);
  console.log(`${language}: ${status}, ${events} events; anonymous access denied`);
}
console.log(`Verified ${cases.length} production execution cases`);
