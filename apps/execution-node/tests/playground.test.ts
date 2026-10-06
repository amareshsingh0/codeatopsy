import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { processJob } from "../src/pipeline.js";
import type { Problem } from "@codeautopsy/schemas";

function hasGxx(): boolean {
  try {
    require("node:child_process").execFileSync("g++", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const problemRoot = join(__dirname, "..", "..", "..", "problems", "binary-search");

function loadProblem(): Problem {
  const meta = JSON.parse(readFileSync(join(problemRoot, "problem.json"), "utf8")) as Omit<
    Problem,
    "referenceSource" | "studentSource"
  >;
  return {
    ...meta,
    referenceSource: readFileSync(join(problemRoot, "reference.cpp"), "utf8"),
    studentSource: readFileSync(join(problemRoot, "student.cpp"), "utf8"),
  };
}

/** any user code — a Kadane implementation with its own custom types and lambdas */
const CUSTOM_CODE = `#include <bits/stdc++.h>
using namespace std;

struct Result {
    long long best;
    int start, end;
};

Result kadane(const vector<int>& a) {
    long long best = LLONG_MIN, cur = 0;
    int start = 0, bestStart = 0, bestEnd = 0;
    for (int i = 0; i < (int)a.size(); i++) {
        cur += a[i];
        if (cur > best) {
            best = cur;
            bestStart = start;
            bestEnd = i;
        }
        if (cur < 0) {
            cur = 0;
            start = i + 1;
        }
    }
    return {best, bestStart, bestEnd};
}

int main() {
    int n;
    if (!(cin >> n)) return 0;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    Result r = kadane(a);
    cout << r.best << " " << r.start << " " << r.end << "\\n";
    return 0;
}
`;

describe.runIf(hasGxx())("pipeline — playground mode (any code, no reference)", () => {
  it("runs arbitrary user code, traces it, and skips the reference stage", async () => {
    const problem: Problem = {
      ...loadProblem(),
      slug: "playground",
      referenceSource: "", // standalone
      tests: [
        { id: "run-1", input: "9\n-2 1 -3 4 -1 2 1 -5 4\n", expectedOutput: "", hidden: false },
      ],
    };
    const result = await processJob({ jobId: "custom-job-1", problem, source: CUSTOM_CODE, autopsy: true });

    expect(result.ok).toBe(true);
    expect(result.compileError).toBeNull();
    expect(result.verdicts[0].status).toBe("accepted"); // no expected output → clean run passes
    expect(result.verdicts[0].output).toContain("6 3 6"); // Kadane on this input
    expect(result.studentTraces["run-1"]?.events.length).toBeGreaterThan(10);
    expect(Object.keys(result.referenceTraces)).toHaveLength(0);
    expect(result.report?.divergence).toBeNull();
    expect(result.report?.provider).toBe("rules");
  }, 180000);
});
