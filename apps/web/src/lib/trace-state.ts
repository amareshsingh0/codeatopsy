import type { TraceEvent } from "@codeautopsy/schemas";

export type ValueView =
  | { kind: "array"; cells: string[]; numbers: number[] | null; truncated: boolean }
  | { kind: "matrix"; rows: string[][] }
  | { kind: "object"; entries: [string, string][] }
  | { kind: "string"; text: string }
  | { kind: "scalar"; text: string; number: number | null };
const display = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
export function parseValueView(raw: string): ValueView {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) {
      if (value.length && value.every((row) => Array.isArray(row)))
        return { kind: "matrix", rows: value.map((row) => row.map(display)) };
      const cells = value.map(display);
      return {
        kind: "array",
        cells,
        numbers: value.every((x) => typeof x === "number" && Number.isFinite(x)) ? value : null,
        truncated: value.some((x) => typeof x === "string" && x.startsWith("<truncated:")),
      };
    }
    if (value && typeof value === "object")
      return { kind: "object", entries: Object.entries(value).map(([k, v]) => [k, display(v)]) };
    if (typeof value === "string") return { kind: "string", text: value };
  } catch {
    /* C++ serializers can include a truncation marker. Preserve its limits. */
  }
  if (/^\[.*\]$/.test(raw) && raw.includes("...(")) {
    const cells = raw
      .slice(1, raw.indexOf("...("))
      .replace(/,\s*$/, "")
      .split(",")
      .map((s) => s.trim());
    return {
      kind: "array",
      cells,
      numbers: cells.every((s) => /^-?\d+(\.\d+)?$/.test(s)) ? cells.map(Number) : null,
      truncated: true,
    };
  }
  const number = raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
  return { kind: "scalar", text: raw, number };
}

export interface Snapshot {
  variables: Map<string, string>;
  stack: string[];
}
interface Frame {
  fn: string;
  parent: Frame | null;
  histories: Map<string, Array<{ index: number; value: string }>>;
}
function latestBefore(history: Array<{ index: number; value: string }>, index: number) {
  let low = 0,
    high = history.length - 1,
    found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (history[mid].index <= index) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found < 0 ? undefined : history[found].value;
}
/** Persistent frame pointers + per-variable histories: O(events) storage, no copied state maps. */
export function createTraceIndex(events: TraceEvent[]) {
  const globals: Frame = { fn: "", parent: null, histories: new Map() };
  let frame = globals;
  const contexts: Frame[] = [];
  const histories = new Map<string, Array<{ index: number; value: string }>>();
  events.forEach((event, index) => {
    if (event.kind === "call") frame = { fn: event.fn || "anonymous", parent: frame, histories: new Map() };
    if (event.kind === "assign" && event.name) {
      const point = { index, value: event.value ?? "?" };
      const local = frame.histories.get(event.name) ?? [];
      local.push(point);
      frame.histories.set(event.name, local);
      const all = histories.get(event.name) ?? [];
      all.push(point);
      histories.set(event.name, all);
    }
    if (event.kind === "return" || event.kind === "returnvoid") frame = frame.parent ?? globals;
    contexts.push(frame);
  });
  return {
    histories,
    snapshot(index: number): Snapshot {
      const end = Math.max(-1, Math.min(events.length - 1, index));
      if (end < 0) return { variables: new Map(), stack: [] };
      const current = contexts[end];
      const stack: string[] = [];
      let module: Frame | undefined;
      for (let cursor: Frame | null = current; cursor?.parent; cursor = cursor.parent) {
        stack.push(cursor.fn);
        if (cursor.fn === "<module>") module = cursor;
      }
      stack.reverse();
      const variables = new Map<string, string>();
      for (const scope of [
        globals,
        ...(module ? [module] : []),
        ...(current !== globals && current !== module ? [current] : []),
      ]) {
        for (const [name, history] of scope.histories) {
          const value = latestBefore(history, end);
          if (value !== undefined) variables.set(name, value);
        }
      }
      return { variables, stack };
    },
  };
}

export function timelineBuckets(events: TraceEvent[], count = 160) {
  const size = Math.max(1, Math.ceil(events.length / count));
  const buckets: Array<{ index: number; kind: TraceEvent["kind"]; count: number }> = [];
  for (let start = 0; start < events.length; start += size) {
    const event = events[start];
    buckets.push({ index: start, kind: event.kind, count: Math.min(size, events.length - start) });
  }
  return buckets;
}
