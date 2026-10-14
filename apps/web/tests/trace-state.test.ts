import { describe, expect, it } from "vitest";
import { createTraceIndex, parseValueView, timelineBuckets } from "../src/lib/trace-state";
import { getDiagnostics } from "../src/lib/diagnostics";
import { emptyFailure } from "@codeautopsy/db";
import type { TraceEvent } from "@codeautopsy/schemas";
describe("visual execution data", () => {
  it("parses nested values and strings containing commas without inventing cells", () => {
    expect(parseValueView('["a,b","c"]')).toMatchObject({ kind: "array", cells: ["a,b", "c"] });
    expect(parseValueView("[[1,2],[3,4]]")).toMatchObject({
      kind: "matrix",
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
    expect(parseValueView('{"count":2}')).toMatchObject({ kind: "object", entries: [["count", "2"]] });
    expect(parseValueView("[1,2,...(10 more)]")).toMatchObject({ kind: "array", truncated: true });
    expect(parseValueView("[1,2")).toMatchObject({ kind: "scalar" });
  });
  it("seeks backwards and across checkpoints without leaking later state", () => {
    const events: TraceEvent[] = Array.from({ length: 10000 }, (_, seq) => ({
      seq,
      kind: "assign",
      line: 1,
      depth: 0,
      name: "counter",
      value: String(seq),
    }));
    const index = createTraceIndex(events);
    for (const position of [9999, 256, 127, 0, -1, 8192])
      expect(index.snapshot(position).variables.get("counter")).toBe(
        position < 0 ? undefined : String(position),
      );
    expect(timelineBuckets(events).length).toBeLessThanOrEqual(160);
    expect(timelineBuckets(events).reduce((sum, bucket) => sum + bucket.count, 0)).toBe(10000);
  });
  it("keeps recursive call frames when seeking", () => {
    const events: TraceEvent[] = ["call", "call", "return", "returnvoid"].map((kind, seq) => ({
      seq,
      kind: kind as TraceEvent["kind"],
      line: 1,
      depth: 1,
      fn: "recurse",
    }));
    const index = createTraceIndex(events);
    expect(index.snapshot(1).stack).toEqual(["recurse", "recurse"]);
    expect(index.snapshot(3).stack).toEqual([]);
  });
  it("extracts source locations and actual runtime messages", () => {
    const result = {
      ...emptyFailure(""),
      error: undefined,
      compileError: { side: "student" as const, stderr: "src.cpp:12:4: error: missing semicolon" },
      verdicts: [
        {
          testId: "run-1",
          status: "runtime_error" as const,
          exitCode: 1,
          durationMs: 10,
          stderr: 'File "main.py", line 7\nValueError: invalid number',
        },
      ],
    };
    expect(getDiagnostics(result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 12, column: 4 }),
        expect.objectContaining({ line: 7, message: "ValueError: invalid number" }),
      ]),
    );
  });
  it("restores caller variables after recursive shadowing instead of leaking the inner value", () => {
    const events: TraceEvent[] = [
      { kind: "assign", name: "global", value: "7" },
      { kind: "call", fn: "f" },
      { kind: "assign", name: "n", value: "3" },
      { kind: "call", fn: "f" },
      { kind: "assign", name: "n", value: "2" },
      { kind: "return", fn: "f" },
    ].map((event, seq) => ({ seq, line: 1, depth: 0, ...event }) as TraceEvent);
    const index = createTraceIndex(events);
    expect(index.snapshot(4).variables.get("n")).toBe("2");
    expect(index.snapshot(5).variables.get("n")).toBe("3");
    expect(index.snapshot(5).variables.get("global")).toBe("7");
  });
  it("handles many unique variables and deep calls without checkpoint copies or future-variable leaks", () => {
    const assignments: TraceEvent[] = Array.from({ length: 20000 }, (_, seq) => ({
      seq,
      kind: "assign",
      line: 1,
      depth: 0,
      name: `v${seq}`,
      value: String(seq),
    }));
    const index = createTraceIndex(assignments);
    expect(index.snapshot(0).variables.size).toBe(1);
    expect(index.snapshot(19999).variables.size).toBe(20000);
    expect(index.snapshot(9999).variables.has("v10000")).toBe(false);
    const calls: TraceEvent[] = Array.from({ length: 5000 }, (_, seq) => ({
      seq,
      kind: "call",
      line: 1,
      depth: seq + 1,
      fn: "recurse",
    }));
    expect(createTraceIndex(calls).snapshot(4999).stack.length).toBe(5000);
  });
});
