import { describe, expect, it } from "vitest";
import {
  createReplayNavigation,
  historyWindow,
  sourceWindow,
  valueChanges,
} from "../src/lib/replay-insights";
import type { TraceEvent } from "@codeautopsy/schemas";
describe("captured replay insights", () => {
  it("distinguishes first observation, unchanged values and actual array/matrix changes", () => {
    expect(valueChanges(undefined, "[1,2]").first).toBe(true);
    expect(valueChanges("[1,2]", "[1,2]").count).toBe(0);
    expect(valueChanges("[1,2]", "[1,9,3]").changes).toEqual([
      { location: "[1]", before: "2", after: "9" },
      { location: "[2]", before: "Not captured", after: "3" },
    ]);
    expect(valueChanges("[[1,2],[3,4]]", "[[1,8],[3,4]]").changes).toEqual([
      { location: "[0][1]", before: "2", after: "8" },
    ]);
  });
  it("bounds change summaries without losing the number of changed fields", () => {
    const delta = valueChanges(JSON.stringify(Array(100).fill(0)), JSON.stringify(Array(100).fill(1)), 3);
    expect(delta.count).toBe(100);
    expect(delta.changes).toHaveLength(3);
    expect(valueChanges('{"score":1,"level":2}', '{"score":3,"level":2}').changes).toEqual([
      { location: ".score", before: "1", after: "3" },
    ]);
  });
  it("finds future values and decisions without inventing an event at the end", () => {
    const events: TraceEvent[] = Array.from({ length: 20000 }, (_, seq) => ({
      seq,
      line: seq + 1,
      kind: seq % 100 === 0 ? "assign" : seq % 7 === 0 ? "branch" : "line",
      depth: 0,
      name: "value",
      value: String(seq),
    }));
    const navigation = createReplayNavigation(events);
    expect(navigation.next(0, "value")).toBe(100);
    expect(navigation.latestValue(19999)).toBe(19900);
    expect(navigation.next(19999, "value")).toBeUndefined();
    expect(navigation.next(0, "decision")).toBe(7);
  });
  it("bounds visible history and source while preserving exact source line numbers", () => {
    const history = Array.from({ length: 20000 }, (_, index) => ({ index, value: String(index) }));
    const window = historyWindow(history, 10000);
    expect(window.count).toBe(10001);
    expect(window.points).toHaveLength(24);
    expect(window.points.at(-1)?.index).toBe(10000);
    const lines = Array.from({ length: 1000 }, (_, i) => `instruction ${i + 1}`);
    const visible = sourceWindow(lines, 998);
    expect(visible).toHaveLength(9);
    expect(visible.find((row) => row.active)?.text).toBe("instruction 998");
    expect(sourceWindow(lines, 1)[0].line).toBe(1);
  });
});
