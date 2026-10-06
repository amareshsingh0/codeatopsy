/**
 * Compacts a full execution comparison into a small evidence digest that is
 * (a) rendered into the report UI and (b) sent to the LLM when one is configured.
 */
import type { Divergence, ExecutionResult, Trace } from "@codeautopsy/schemas";
import { eventText } from "./align";
import { detectHotLoops, detectTruncation, type TraceFinding } from "./findings";

export interface EvidenceDigest {
  verdictSummary: string;
  divergence: {
    testId: string;
    kind: string;
    student: string;
    reference: string;
    studentLine?: number;
    referenceLine?: number;
  } | null;
  /** events around the divergence from both sides */
  context: Array<{
    side: "student" | "reference";
    seq: number;
    line: number;
    text: string;
  }>;
  findings: TraceFinding[];
  /** values of the most active variables just before the divergence */
  variableState: Array<{ name: string; student: string; reference: string }>;
}

const CONTEXT_RADIUS = 8;

function collectContext(trace: Trace, aroundSeq: number): EvidenceDigest["context"] {
  const bySeq = new Map(trace.events.map((e) => [e.seq, e]));
  const out: EvidenceDigest["context"] = [];
  for (let s = Math.max(0, aroundSeq - CONTEXT_RADIUS); s <= aroundSeq + 2; s++) {
    const e = bySeq.get(s);
    if (e) {
      out.push({ side: trace.meta.side, seq: e.seq, line: e.line, text: eventText(e) });
    }
  }
  return out;
}

export function buildEvidence(
  result: ExecutionResult,
  studentTrace: Trace | undefined,
  referenceTrace: Trace | undefined,
  divergence: Divergence | null,
): EvidenceDigest {
  const failed = result.verdicts.filter((v) => v.status !== "accepted");
  const verdictSummary =
    result.verdicts.length === 0
      ? "no test verdicts"
      : `${result.verdicts.length - failed.length}/${result.verdicts.length} tests passed` +
        (failed.length ? `; failed: ${failed.map((v) => v.testId).join(", ")}` : "");

  const context: EvidenceDigest["context"] = [];
  if (studentTrace && divergence) context.push(...collectContext(studentTrace, divergence.studentSeq));
  if (referenceTrace && divergence) context.push(...collectContext(referenceTrace, divergence.referenceSeq));

  const findings: TraceFinding[] = [
    ...(studentTrace ? detectHotLoops(studentTrace) : []),
    ...(studentTrace ? detectTruncation(studentTrace) : []),
  ];

  // variable state: last value of each variable seen in the 12 events before divergence
  const variableState: EvidenceDigest["variableState"] = [];
  if (studentTrace && referenceTrace && divergence) {
    const collect = (trace: Trace, upto: number) => {
      const map = new Map<string, string>();
      for (const e of trace.events) {
        if (e.seq >= upto) break;
        if (e.kind === "assign" && e.name) map.set(e.name, e.value ?? "?");
      }
      return map;
    };
    const sm = collect(studentTrace, divergence.studentSeq);
    const rm = collect(referenceTrace, divergence.referenceSeq);
    for (const [name, value] of sm) {
      if (rm.has(name)) variableState.push({ name, student: value, reference: rm.get(name)! });
    }
    variableState.sort((a, b) => (a.student === b.student ? 0 : a.student === b.reference ? -1 : 1));
    variableState.splice(8);
  }

  return {
    verdictSummary,
    divergence: divergence
      ? {
          testId: divergence.testId,
          kind: divergence.kind,
          student: divergence.studentText,
          reference: divergence.referenceText,
          studentLine: divergence.studentLine,
          referenceLine: divergence.referenceLine,
        }
      : null,
    context,
    findings,
    variableState,
  };
}
