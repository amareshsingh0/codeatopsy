import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { processJob } from "../src/pipeline";
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

describe.runIf(hasGxx())("pipeline — binary-search end to end", () => {
  it("produces verdicts, traces, divergence and an off-by-one report", async () => {
    const problem = loadProblem();
    const result = await processJob({
      jobId: "test-job-1",
      problem,
      source: problem.studentSource,
      autopsy: true,
    });

    // verdicts: the exclusive guard fails whenever the interval narrows to a
    // single element before probing — t1 (last), t2 (first), t4 (single), t6.
    // t3 passes (target found at the exact first midpoint), t5 (not found).
    const byId = new Map(result.verdicts.map((v) => [v.testId, v]));
    expect(byId.get("t1")?.status).toBe("wrong_answer");
    expect(byId.get("t2")?.status).toBe("wrong_answer");
    expect(byId.get("t3")?.status).toBe("accepted");
    expect(byId.get("t4")?.status).toBe("wrong_answer");
    expect(byId.get("t5")?.status).toBe("accepted");
    expect(byId.get("t6")?.status).toBe("wrong_answer");

    // traces captured for the first failing test
    expect(result.studentTraces["t1"]?.events.length).toBeGreaterThan(5);
    expect(result.referenceTraces["t1"]?.events.length).toBeGreaterThan(5);

    // report
    expect(result.report).toBeTruthy();
    expect(result.report!.provider).toBe("rules"); // no API key in tests
    expect(result.report!.divergence).toBeTruthy();
    expect(result.report!.divergence!.testId).toBe("t1");
    expect(result.report!.headline.toLowerCase()).toContain("wrong answer");
    const top = result.report!.hypotheses[0];
    expect(top.title.toLowerCase()).toContain("off-by-one");
    expect(top.mechanism).toContain("left < right");
  }, 180000);
});
