import { describe, expect, it } from "vitest";
import { detectStructure } from "../src/lib/structures";
describe("evidence-based structure interpretation", () => {
  it("keeps binary and multi-child trees faithful to captured edges and incomplete markers", () => {
    const binary = detectStructure(
      JSON.stringify({ value: 4, left: { value: 2, left: null, right: null }, right: "<depth limit>" }),
    )!;
    expect(binary.kind).toBe("tree");
    expect(binary.nodes.map((node) => node.label)).toEqual(["4", "2", "<depth limit>"]);
    expect(binary.partial).toBe(true);
    expect(binary.edges).toHaveLength(2);
    expect(detectStructure('{"value":1,"children":[{"value":2},{"value":3}]}')?.nodes).toHaveLength(3);
  });
  it("preserves linked order without inventing cycle identity or missing neighbors", () => {
    const linked = detectStructure('{"val":1,"next":{"val":2,"next":"<circular>"}}')!;
    expect(linked.kind).toBe("linked");
    expect(linked.partial).toBe(true);
    expect(linked.nodes).toHaveLength(3);
    expect(detectStructure('{"0":[1],"1":[0]}')?.edges).toEqual([
      { from: "0", to: "1" },
      { from: "1", to: "0" },
    ]);
    expect(detectStructure('{"0":[9]}')).toBeNull();
  });
  it("never guesses algorithm semantics from scalar, matrix, ordinary object or invalid JSON", () => {
    for (const raw of ["42", "[[1,2],[3,4]]", '{"score":2}', '{"next":'])
      expect(detectStructure(raw)).toBeNull();
  });
  it("bounds large structures and reports incomplete visualization", () => {
    const children = Array.from({ length: 100 }, (_, value) => ({ value }));
    const model = detectStructure(JSON.stringify({ children }))!;
    expect(model.nodes.length).toBe(60);
    expect(model.partial).toBe(true);
  });
});
