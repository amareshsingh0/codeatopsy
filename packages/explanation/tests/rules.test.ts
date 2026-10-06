import { describe, it, expect } from "vitest";
import { diagnose } from "../src/rules";
import type { ExecutionResult, Trace, TraceEvent, Divergence } from "@codeautopsy/schemas";
import { buildEvidence, alignTraces } from "@codeautopsy/trace-core";

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

const offByOne: { student: Trace; reference: Trace } = (() => {
  const student = mkTrace("student", [
    ev({ kind: "assign", name: "left", value: "2", line: 8 }),
    ev({ kind: "branch", cond: "left < right", taken: false, line: 8 }),
    ev({ kind: "return", value: "-1", line: 18 }),
  ]);
  const reference = mkTrace("reference", [
    ev({ kind: "assign", name: "left", value: "2", line: 8 }),
    ev({ kind: "branch", cond: "left <= right", taken: true, line: 8 }),
    ev({ kind: "assign", name: "mid", value: "2", line: 9 }),
  ]);
  return { student, reference };
})();

const baseResult: ExecutionResult = {
  ok: true,
  compileError: null,
  verdicts: [{ testId: "t1", status: "wrong_answer", exitCode: 0, durationMs: 3 }],
  studentTraces: {},
  referenceTraces: {},
  report: null,
};

describe("rule-based diagnosis", () => {
  it("identifies the off-by-one loop guard", async () => {
    seq = 0;
    const div = alignTraces(offByOne.student, offByOne.reference, "t1").divergence!;
    const digest = buildEvidence(baseResult, offByOne.student, offByOne.reference, div);
    const { headline, hypotheses, narrative } = diagnose(
      baseResult,
      offByOne.student,
      offByOne.reference,
      div,
      digest,
      "left < right should be left <= right",
    );
    expect(headline).toContain("t1");
    expect(hypotheses[0].title.toLowerCase()).toContain("off-by-one");
    expect(hypotheses[0].mechanism).toContain("left < right");
    expect(narrative).toContain("Root-cause hypotheses");
    expect(narrative).toContain("First divergence");
  });

  it("handles compile errors", () => {
    const r: ExecutionResult = { ...baseResult, ok: false, compileError: { side: "student", stderr: "error: expected ';' at line 3" } };
    const d = diagnose(r, undefined, undefined, null, buildEvidence(r, undefined, undefined, null));
    expect(d.headline).toContain("Compile error");
    expect(d.hypotheses[0].id).toBe("compile-error");
  });
});
