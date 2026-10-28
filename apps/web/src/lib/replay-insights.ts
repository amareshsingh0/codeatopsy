import type { TraceEvent } from "@codeautopsy/schemas";
import { parseValueView } from "./trace-state";

export const compactValue = (value: string, limit = 96) =>
  value.length > limit ? value.slice(0, limit) + "…" : value;
export interface CapturedChange {
  location: string;
  before: string;
  after: string;
}
export function valueChanges(before: string | undefined, after: string, limit = 8) {
  const old = parseValueView(before ?? "");
  const next = parseValueView(after);
  const changes: CapturedChange[] = [];
  let count = 0;
  const add = (location: string, a: string | undefined, b: string | undefined) => {
    if (a === b) return;
    count++;
    if (changes.length < limit)
      changes.push({ location, before: a ?? "Not captured", after: b ?? "Not captured" });
  };
  if (before !== undefined && old.kind === "array" && next.kind === "array") {
    for (let i = 0; i < Math.max(old.cells.length, next.cells.length); i++)
      add(`[${i}]`, old.cells[i], next.cells[i]);
  } else if (before !== undefined && old.kind === "matrix" && next.kind === "matrix") {
    for (let r = 0; r < Math.max(old.rows.length, next.rows.length); r++)
      for (let c = 0; c < Math.max(old.rows[r]?.length ?? 0, next.rows[r]?.length ?? 0); c++)
        add(`[${r}][${c}]`, old.rows[r]?.[c], next.rows[r]?.[c]);
  } else if (before !== undefined && old.kind === "object" && next.kind === "object") {
    const a = new Map(old.entries),
      b = new Map(next.entries);
    for (const key of new Set([...a.keys(), ...b.keys()])) add(`.${key}`, a.get(key), b.get(key));
  } else add("", before, after);
  return { changes, count, first: before === undefined };
}

/** Binary search shared by history windows and event navigation. */
export function upperBound(values: readonly number[], value: number) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function createReplayNavigation(events: TraceEvent[]) {
  const values: number[] = [],
    decisions: number[] = [];
  events.forEach((event, i) => {
    if (event.kind === "assign") values.push(i);
    if (event.kind === "branch") decisions.push(i);
  });
  return {
    values,
    decisions,
    next(index: number, kind: "value" | "decision") {
      const list = kind === "value" ? values : decisions;
      return list[upperBound(list, index)];
    },
    latestValue(index: number) {
      return values[upperBound(values, index) - 1];
    },
  };
}
export function historyWindow(history: Array<{ index: number; value: string }>, index: number, limit = 24) {
  let lo = 0,
    hi = history.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (history[mid].index <= index) lo = mid + 1;
    else hi = mid;
  }
  return { count: lo, points: history.slice(Math.max(0, lo - limit), lo) };
}
export function sourceWindow(lines: string[], line: number, size = 9) {
  const active = Math.max(1, Math.min(lines.length, line));
  const start = Math.max(0, Math.min(lines.length - size, active - 1 - Math.floor(size / 2)));
  return lines
    .slice(start, start + size)
    .map((text, i) => ({ line: start + i + 1, text, active: start + i + 1 === active }));
}
