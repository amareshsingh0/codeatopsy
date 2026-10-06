/**
 * Generic, language-agnostic trace checks that feed the explanation engine.
 */
import type { Trace, TraceEvent } from "@codeautopsy/schemas";

export interface TraceFinding {
  id: string;
  title: string;
  detail: string;
  lines: number[];
  seqs: number[];
}

/** same branch condition evaluated many times in a row → possible non-termination */
export function detectHotLoops(trace: Trace, threshold = 2000): TraceFinding[] {
  const findings: TraceFinding[] = [];
  let runStart = -1;
  let runCond = "";
  let runLine = -1;
  const flush = (end: number) => {
    const len = end - runStart;
    if (runStart >= 0 && len >= threshold) {
      findings.push({
        id: "hot-loop",
        title: "Loop executed a very large number of iterations",
        detail: `The condition "${runCond}" (line ${runLine}) was evaluated ${len} times in a row — the loop may never terminate or may be doing far more work than needed.`,
        lines: [runLine],
        seqs: [runStart, end - 1],
      });
    }
    runStart = -1;
  };
  for (let k = 0; k < trace.events.length; k++) {
    const e = trace.events[k];
    if (e.kind !== "branch") {
      // assignments inside a loop body do not reset "hot" detection: a loop
      // counter changes every iteration, so require *consecutive identical*
      // branch events with no other branch in between
      continue;
    }
    const key = `${e.cond}@${e.line}`;
    if (key === runCond + "@" + runLine) continue;
    flush(k);
    runStart = k;
    runCond = e.cond ?? "";
    runLine = e.line;
  }
  flush(trace.events.length);
  return findings;
}

/** the runtime hit its event/time budget — execution was cut short */
export function detectTruncation(trace: Trace): TraceFinding[] {
  if (!trace.meta.truncated) return [];
  const last = trace.events[trace.events.length - 1];
  return [
    {
      id: "truncated",
      title: "Trace was truncated",
      detail:
        "The instrumented run hit its event/time budget before the program finished. Combined with a timeout verdict this strongly suggests a non-terminating loop.",
      lines: last ? [last.line] : [],
      seqs: last ? [last.seq] : [],
    },
  ];
}

/** track a single variable's value across the trace */
export function variableHistory(trace: Trace, name: string): TraceEvent[] {
  return trace.events.filter((e) => e.kind === "assign" && e.name === name);
}
