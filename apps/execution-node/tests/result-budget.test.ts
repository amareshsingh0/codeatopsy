import { describe, expect, it } from "vitest";
import { boundResultPreviews } from "../src/result-budget";
import { ExecutionResult } from "@codeautopsy/schemas";

describe("execution result response budgets", () => {
  it("preserves verdicts while bounding aggregate output across tests", () => {
    const result = ExecutionResult.parse({
      ok: true,
      compileError: null,
      verdicts: Array.from({ length: 20 }, (_, i) => ({
        testId: String(i),
        status: "accepted",
        durationMs: 1,
        exitCode: 0,
        output: "x".repeat(100000),
        stderr: "",
      })),
      studentTraces: {},
      referenceTraces: {},
      report: null,
    });
    const bounded = boundResultPreviews(result);
    expect(bounded.verdicts.every((v) => v.status === "accepted")).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThan(210 * 1024);
    expect(bounded.verdicts[2].output).toContain("truncated");
  });
  it("keeps a truthful trace prefix when combined traces exceed the budget", () => {
    const events = Array.from({ length: 4000 }, (_, seq) => ({
      seq,
      kind: "assign",
      line: 1,
      depth: 0,
      name: "values",
      value: "x".repeat(400),
    }));
    const result = ExecutionResult.parse({
      ok: true,
      compileError: null,
      verdicts: [],
      studentTraces: {
        t: {
          meta: {
            problemId: "playground",
            testId: "t",
            side: "student",
            exitCode: 0,
            durationMs: 1,
            truncated: false,
          },
          events,
        },
      },
      referenceTraces: {},
      report: null,
    });
    const trace = boundResultPreviews(result).studentTraces.t;
    expect(trace.meta.truncated).toBe(true);
    expect(trace.events.length).toBeGreaterThan(0);
    expect(trace.events.length).toBeLessThan(events.length);
    expect(trace.events.at(-1)?.seq).toBe(trace.events.length - 1);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(930 * 1024);
  });
});
