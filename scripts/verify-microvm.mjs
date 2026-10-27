// Public fixture cases only. Run inside the disposable prepared build VM.
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
const memory = Number(process.env.AUTOPSY_VM_MEMORY_MB ?? 4096);
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
  [
    "javascript",
    "const fs=require('fs');console.log(fs.existsSync('/opt/codeautopsy/job.cjs'));console.log(fs.existsSync('/sys/fs/cgroup'));console.log(process.getuid());",
    "",
    "false\nfalse\n1000\n",
    "accepted",
  ],
  [
    "python",
    "import os, socket\ns=socket.socket()\ns.settimeout(.1)\ntry:\n s.connect(('1.1.1.1',443));print('open')\nexcept OSError:\n print('blocked')\nprint(os.getuid())",
    "",
    "blocked\n1000\n",
    "accepted",
  ],
];
let index = 0;
for (const [language, source, input, expectedOutput, status] of cases) {
  const job = {
    jobId: `fixture-${index}`,
    source,
    language,
    autopsy: true,
    problem: {
      slug: "playground",
      title: "Fixture",
      difficulty: "easy",
      blurb: "",
      statement: "",
      topics: [],
      language,
      timeLimitMs: status === "timeout" ? 300 : 5000,
      memoryLimitMb: memory,
      tests: [{ id: "t1", input, expectedOutput, hidden: false }],
      referenceSource: "",
      studentSource: source,
    },
  };
  const fixture = `/opt/codeautopsy/fixture-${index}.json`;
  writeFileSync(fixture, JSON.stringify(job), { mode: 0o600 });
  const child = spawn("node", ["/opt/codeautopsy/job.cjs", fixture], {
    cwd: "/opt/codeautopsy",
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      AUTOPSY_SANDBOX: "microvm",
      AUTOPSY_ISOLATED_VM: "1",
      AUTOPSY_VM_MEMORY_MB: String(memory),
    },
  });
  let diagnostics = "";
  child.stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-2000);
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  let result;
  try {
    result = JSON.parse(readFileSync("/vercel/sandbox/result.json", "utf8"));
  } catch (error) {
    console.error(JSON.stringify({ index, language, code, diagnostics }));
    throw error;
  }
  const actual = result.compileError ? "compile_error" : result.verdicts[0]?.status;
  const events = result.studentTraces?.t1?.events.length ?? 0;
  if (code !== 0 || actual !== status || (status === "accepted" && index < 4 && events === 0)) {
    console.error(
      JSON.stringify({
        index,
        language,
        expected: status,
        actual,
        error: result.error,
        compile: result.compileError,
        verdict: result.verdicts[0],
        diagnostics,
      }),
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      index,
      language,
      status: actual,
      events,
      output: result.verdicts[0]?.output?.slice(0, 90),
    }),
  );
  index++;
}
console.log(`Verified ${index} isolated execution cases`);
