/**
 * Alignment + divergence detection between a student trace and a reference
 * trace of the same algorithm on the same input.
 *
 * Events are matched semantically (variable name for assignments, condition
 * text for branches with fuzzy matching so `left < right` vs `left <= right`
 * still align), then compared. The first mismatch — a differing value, a
 * different branch outcome, or a structural desync — is the divergence.
 */
import type { Divergence, Trace, TraceEvent } from "@codeautopsy/schemas";

export interface AlignResult {
  divergence: Divergence | null;
  /** number of event pairs compared before divergence (or total if none) */
  matched: number;
  /** events skipped on either side while resyncing */
  skippedStudent: number;
  skippedReference: number;
  /** matched event pairs (student seq ↔ reference seq), used for synchronized playback */
  pairs: Array<{ s: number; r: number }>;
}

const WINDOW = 12; // resync lookahead

function normCond(s: string): string {
  return s.replace(/\s+/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** branches align when their conditions are identical or near-identical text */
function condsAlign(a: string, b: string): boolean {
  const na = normCond(a), nb = normCond(b);
  if (na === nb) return true;
  return levenshtein(na, nb) <= Math.max(2, Math.floor(Math.min(na.length, nb.length) * 0.25));
}

function comparable(a: TraceEvent, b: TraceEvent): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "assign":
      return a.name === b.name;
    case "branch":
      return !!a.cond && !!b.cond && condsAlign(a.cond, b.cond);
    case "call":
      return a.fn === b.fn;
    case "return":
    case "returnvoid":
      return true;
    default:
      return false;
  }
}

/** did the two matched events actually disagree? */
function disagree(a: TraceEvent, b: TraceEvent): boolean {
  switch (a.kind) {
    case "assign":
      return a.value !== b.value;
    case "branch":
      return a.taken !== b.taken;
    case "return":
      return a.value !== b.value;
    default:
      return false;
  }
}

function eventText(e: TraceEvent): string {
  switch (e.kind) {
    case "assign": return `${e.name} = ${e.value}`;
    case "branch": return `condition "${e.cond}" → ${e.taken ? "true" : "false"}`;
    case "call": return `call ${e.fn}()`;
    case "return": return `${e.fn}() returned ${e.value}`;
    case "returnvoid": return `${e.fn}() returned`;
    default: return e.kind;
  }
}

function kindToDivKind(kind: TraceEvent["kind"]): Divergence["kind"] {
  switch (kind) {
    case "assign": return "value";
    case "branch": return "control";
    default: return "value";
  }
}

export function alignTraces(student: Trace, reference: Trace, testId: string): AlignResult {
  const s = student.events, r = reference.events;
  let i = 0, j = 0, matched = 0, skippedStudent = 0, skippedReference = 0;
  const pairs: Array<{ s: number; r: number }> = [];

  while (i < s.length && j < r.length) {
    const a = s[i], b = r[j];
    if (comparable(a, b)) {
      pairs.push({ s: a.seq, r: b.seq });
      if (disagree(a, b)) {
        return {
          divergence: {
            testId,
            studentSeq: a.seq,
            referenceSeq: b.seq,
            kind: kindToDivKind(a.kind),
            studentText: eventText(a),
            referenceText: eventText(b),
            studentLine: a.line,
            referenceLine: b.line,
          },
          matched,
          skippedStudent,
          pairs,
          skippedReference,
        };
      }
      i++; j++; matched++;
      continue;
    }
    // try to resync within a lookahead window on both sides
    let resynced = false;
    outer: for (let dj = 0; dj <= WINDOW && j + dj < r.length; dj++) {
      for (let di = dj === 0 ? 1 : 0; di <= WINDOW && i + di < s.length; di++) {
        if (comparable(s[i + di], r[j + dj])) {
          skippedStudent += di;
          skippedReference += dj;
          i += di; j += dj;
          resynced = true;
          break outer;
        }
      }
    }
    if (!resynced) {
      return {
        divergence: {
          testId,
          studentSeq: a.seq,
          referenceSeq: b.seq,
          kind: "control",
          studentText: eventText(a),
          referenceText: eventText(b),
          studentLine: a.line,
          referenceLine: b.line,
        },
        matched,
        skippedStudent,
        skippedReference,
        pairs,
      };
    }
  }

  if (i < s.length || j < r.length) {
    const a = s[i] ?? s[s.length - 1];
    const b = r[j] ?? r[r.length - 1];
    const kind = i >= s.length ? "missing" : "extra";
    return {
      divergence: {
        testId,
        studentSeq: a?.seq ?? 0,
        referenceSeq: b?.seq ?? 0,
        kind,
        studentText: i < s.length ? eventText(a) : "(student trace ended)",
        referenceText: j < r.length ? eventText(b) : "(reference trace ended)",
        studentLine: i < s.length ? a?.line : undefined,
        referenceLine: j < r.length ? b?.line : undefined,
      },
      matched,
      skippedStudent,
      pairs,
      skippedReference,
    };
  }

  return { divergence: null, matched, skippedStudent, skippedReference, pairs };
}

export { eventText };
