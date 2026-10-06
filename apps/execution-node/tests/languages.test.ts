import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { processJob } from "../src/pipeline.js";
import type { Problem } from "@codeautopsy/schemas";

function has(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasPython = has(process.env.AUTOPSY_PYTHON || "python", ["--version"]);
const hasNode = has("node", ["--version"]);
const hasJava = has(process.env.AUTOPSY_JAVA || "java", ["--version"]);

function mkProblem(over: Partial<Problem>): Problem {
  return {
    slug: "playground",
    title: "Playground run",
    difficulty: "easy",
    blurb: "",
    statement: "",
    topics: [],
    language: "cpp",
    timeLimitMs: 5000,
    memoryLimitMb: 256,
    tests: [{ id: "run-1", input: "9\n-2 1 -3 4 -1 2 1 -5 4\n", expectedOutput: "", hidden: false }],
    referenceSource: "",
    studentSource: "",
    ...over,
  };
}

describe.runIf(hasPython)("pipeline — python", () => {
  it("runs python code and produces a trace via sys.settrace", async () => {
    const source = `n = int(input())
a = [int(x) for x in input().split()]

best = 0
cur = 0
for x in a:
    cur = max(cur + x, x)
    best = max(best, cur)
print(best)
`;
    const problem = mkProblem({ language: "python" });
    const result = await processJob({ jobId: "py-job-1", problem, source, language: "python", autopsy: true });

    expect(result.ok).toBe(true);
    expect(result.verdicts[0].status).toBe("accepted");
    expect(result.verdicts[0].output?.trim()).toBe("6");
    const trace = result.studentTraces["run-1"];
    expect(trace).toBeTruthy();
    expect(trace!.events.length).toBeGreaterThan(10);
    const assigns = trace!.events.filter((e) => e.kind === "assign" && e.name === "cur");
    expect(assigns.length).toBeGreaterThan(3); // loop iterations captured
  }, 120000);
});

describe.runIf(hasNode)("pipeline — javascript", () => {
  it("runs JS code and produces a trace via the acorn instrumenter", async () => {
    const NL = String.fromCharCode(10);
    // portable stdin pattern (readFileSync(0) is unreliable on Windows); no escape sequences
    const source = [
      'let input = "";',
      'process.stdin.on("data", (d) => (input += d));',
      'process.stdin.on("end", () => {',
      '  const lines = input.split(String.fromCharCode(10));',
      '  const n = parseInt(lines[0]);',
      '  const a = lines[1].split(" ").map(Number);',
      '',
      '  let best = 0;',
      '  let cur = 0;',
      '  for (let i = 0; i < n; i++) {',
      '    cur = Math.max(cur + a[i], a[i]);',
      '    best = Math.max(best, cur);',
      '  }',
      '  console.log(best);',
      '});',
    ].join(NL);
    const problem = mkProblem({ language: "javascript" });
    const result = await processJob({ jobId: "js-job-1", problem, source, language: "javascript", autopsy: true });

    expect(result.ok).toBe(true);
    expect(result.verdicts[0].status).toBe("accepted");
    expect(result.verdicts[0].output?.trim()).toBe("6");
    const trace = result.studentTraces["run-1"];
    expect(trace).toBeTruthy();
    expect(trace!.events.filter((e) => e.kind === "assign" && e.name === "cur").length).toBeGreaterThan(3);
    expect(trace!.events.some((e) => e.kind === "branch")).toBe(true);
  }, 120000);
});

describe.runIf(hasJava)("pipeline — java", () => {
  it("runs single-file java and returns verdicts with output", async () => {
    const source = `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int best = 0, cur = 0;
        for (int i = 0; i < n; i++) {
            int x = sc.nextInt();
            cur = Math.max(cur + x, x);
            best = Math.max(best, cur);
        }
        System.out.println(best);
    }
}
`;
    const problem = mkProblem({ language: "java" });
    const result = await processJob({ jobId: "java-job-1", problem, source, language: "java", autopsy: true });

    expect(result.ok).toBe(true);
    expect(result.verdicts[0].status).toBe("accepted");
    expect(result.verdicts[0].output?.trim()).toBe("6");
  }, 120000);
});
