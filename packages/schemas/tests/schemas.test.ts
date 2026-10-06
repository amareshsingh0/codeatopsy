import { describe, it, expect } from "vitest";
import { TraceEvent, Problem, parseTraceJsonl, TraceMeta } from "../src/index";

const meta: TraceMeta = {
  problemId: "binary-search",
  testId: "t1",
  side: "student",
  exitCode: 0,
  durationMs: 12,
  truncated: false,
};

describe("parseTraceJsonl", () => {
  it("parses compact runtime JSONL into validated events", () => {
    const raw = [
      '{"k":"assign","l":5,"n":"left","v":"0","d":1}',
      '{"k":"branch","l":7,"c":"left < right","t":true,"d":1}',
      "",
      "garbage line",
    ].join("\n");
    const { trace, dropped } = parseTraceJsonl(raw, meta);
    expect(dropped).toBe(1);
    expect(trace.events).toHaveLength(2);
    expect(trace.events[0]).toMatchObject({ seq: 0, kind: "assign", name: "left", value: "0", line: 5 });
    expect(trace.events[1]).toMatchObject({ seq: 1, kind: "branch", taken: true });
  });

  it("rejects events with unknown kinds", () => {
    expect(() => TraceEvent.parse({ seq: 0, kind: "nope", line: 1, depth: 0 })).toThrow();
  });
});

describe("Problem schema", () => {
  it("applies defaults", () => {
    const p = Problem.parse({
      slug: "demo",
      title: "Demo",
      difficulty: "easy",
      blurb: "b",
      statement: "s",
      tests: [{ id: "t1", input: "1", expectedOutput: "1" }],
      referenceSource: "int main(){}",
      studentSource: "int main(){}",
    });
    expect(p.tests[0].hidden).toBe(false);
    expect(p.timeLimitMs).toBe(5000);
    expect(p.topics).toEqual([]);
  });
});
