import { describe, it, expect } from "vitest";
import { alignTraces } from "../src/align";
import { detectHotLoops, variableHistory } from "../src/findings";
import { buildEvidence } from "../src/evidence";
import type { Trace, TraceEvent } from "@codeautopsy/schemas";

let seq = 0;
function ev(p: Partial<TraceEvent> & { kind: TraceEvent["kind"] }): TraceEvent {
  return { seq: seq++, line: 1, depth: 0, ...p } as TraceEvent;
}
function mkTrace(side: "student" | "reference", events: TraceEvent[]): Trace {
  seq = 0;
  return {
    meta: { problemId: "p", testId: "t1", side, exitCode: 0, durationMs: 1, truncated: false },
    events,
  };
}

describe("alignTraces", () => {
  it("finds a branch-outcome divergence (off-by-one loop guard)", () => {
    // student: while (left < right) — gives up one iteration early
    const student = mkTrace("student", [
      ev({ kind: "call", fn: "binarySearch", line: 4 }),
      ev({ kind: "assign", name: "left", value: "0", line: 5 }),
      ev({ kind: "assign", name: "right", value: "2", line: 6 }),
      ev({ kind: "branch", cond: "left < right", taken: true, line: 8 }),
      ev({ kind: "assign", name: "mid", value: "1", line: 9 }),
      ev({ kind: "branch", cond: "a[mid] == target", taken: false, line: 11 }),
      ev({ kind: "branch", cond: "a[mid] < target", taken: true, line: 13 }),
      ev({ kind: "assign", name: "left", value: "2", line: 14 }),
      ev({ kind: "branch", cond: "left < right", taken: false, line: 8 }), // gives up
      ev({ kind: "return", value: "-1", line: 18 }),
    ]);
    const reference = mkTrace("reference", [
      ev({ kind: "call", fn: "binarySearch", line: 4 }),
      ev({ kind: "assign", name: "left", value: "0", line: 5 }),
      ev({ kind: "assign", name: "right", value: "2", line: 6 }),
      ev({ kind: "branch", cond: "left <= right", taken: true, line: 8 }),
      ev({ kind: "assign", name: "mid", value: "1", line: 9 }),
      ev({ kind: "branch", cond: "a[mid] == target", taken: false, line: 11 }),
      ev({ kind: "branch", cond: "a[mid] < target", taken: true, line: 13 }),
      ev({ kind: "assign", name: "left", value: "2", line: 14 }),
      ev({ kind: "branch", cond: "left <= right", taken: true, line: 8 }), // still searching!
      ev({ kind: "assign", name: "mid", value: "2", line: 9 }),
      ev({ kind: "branch", cond: "a[mid] == target", taken: true, line: 11 }),
      ev({ kind: "return", value: "2", line: 12 }),
    ]);
    const res = alignTraces(student, reference, "t1");
    expect(res.divergence).not.toBeNull();
    expect(res.divergence!.kind).toBe("control");
    expect(res.divergence!.studentSeq).toBe(8);
    expect(res.divergence!.referenceSeq).toBe(8);
    expect(res.divergence!.studentText).toContain("left < right");
  });

  it("finds a value divergence on a variable", () => {
    const student = mkTrace("student", [
      ev({ kind: "assign", name: "i", value: "0", line: 2 }),
      ev({ kind: "assign", name: "sum", value: "0", line: 3 }),
      ev({ kind: "assign", name: "sum", value: "5", line: 5 }),
    ]);
    const reference = mkTrace("reference", [
      ev({ kind: "assign", name: "i", value: "0", line: 2 }),
      ev({ kind: "assign", name: "sum", value: "0", line: 3 }),
      ev({ kind: "assign", name: "sum", value: "15", line: 5 }),
    ]);
    const res = alignTraces(student, reference, "t1");
    expect(res.divergence!.kind).toBe("value");
    expect(res.divergence!.studentText).toContain("sum = 5");
    expect(res.divergence!.referenceText).toContain("sum = 15");
  });

  it("returns null for identical traces", () => {
    const events = [
      ev({ kind: "assign", name: "x", value: "1", line: 2 }),
      ev({ kind: "branch", cond: "x > 0", taken: true, line: 3 }),
    ];
    const res = alignTraces(mkTrace("student", events), mkTrace("reference", [...events]), "t1");
    expect(res.divergence).toBeNull();
    expect(res.matched).toBe(2);
  });

  it("does not false-positive on small line-number-only differences", () => {
    const s = mkTrace("student", [ev({ kind: "assign", name: "x", value: "1", line: 10 })]);
    const r = mkTrace("reference", [ev({ kind: "assign", name: "x", value: "1", line: 42 })]);
    expect(alignTraces(s, r, "t1").divergence).toBeNull();
  });
});

describe("findings", () => {
  it("detects hot loops", () => {
    const events: TraceEvent[] = [];
    seq = 0;
    for (let i = 0; i < 2500; i++) events.push(ev({ kind: "branch", cond: "i < n", taken: true, line: 5 }));
    const trace = mkTrace("student", events);
    expect(detectHotLoops(trace, 2000)).toHaveLength(1);
  });

  it("extracts variable history", () => {
    const t = mkTrace("student", [
      ev({ kind: "assign", name: "x", value: "1", line: 2 }),
      ev({ kind: "assign", name: "y", value: "2", line: 3 }),
      ev({ kind: "assign", name: "x", value: "3", line: 4 }),
    ]);
    expect(variableHistory(t, "x")).toHaveLength(2);
  });
});

describe("buildEvidence", () => {
  it("summarizes verdicts and divergence context", () => {
    seq = 0;
    const student = mkTrace("student", [
      ev({ kind: "assign", name: "left", value: "0", line: 5 }),
      ev({ kind: "branch", cond: "left < right", taken: false, line: 8 }),
    ]);
    const reference = mkTrace("reference", [
      ev({ kind: "assign", name: "left", value: "0", line: 5 }),
      ev({ kind: "branch", cond: "left <= right", taken: true, line: 8 }),
    ]);
    const ev0 = alignTraces(student, reference, "t1").divergence!;
    const digest = buildEvidence(
      {
        ok: true,
        compileError: null,
        verdicts: [
          { testId: "t1", status: "wrong_answer", exitCode: 0, durationMs: 3 },
          { testId: "t2", status: "accepted", exitCode: 0, durationMs: 2 },
        ],
        studentTraces: {},
        referenceTraces: {},
        report: null,
      },
      student,
      reference,
      ev0,
    );
    expect(digest.verdictSummary).toContain("1/2 tests passed");
    expect(digest.divergence!.kind).toBe("control");
    expect(digest.context.length).toBeGreaterThan(0);
    expect(digest.variableState).toContainEqual({ name: "left", student: "0", reference: "0" });
  });
});
