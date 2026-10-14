export interface StructureNode {
  id: string;
  label: string;
  depth: number;
  parent?: string;
  relation?: string;
  partial?: boolean;
}
export interface StructureEdge {
  from: string;
  to: string;
  label?: string;
}
export interface StructureModel {
  kind: "tree" | "linked" | "graph";
  nodes: StructureNode[];
  edges: StructureEdge[];
  ambiguous: boolean;
  partial: boolean;
  explanation: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const summary = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
const marker = (value: unknown) =>
  typeof value === "string" && /^<(?:circular|depth limit|truncated|snapshot)/.test(value);
/** Structural views are derived exclusively from valid captured JSON. No variable-name algorithm guesses. */
export function detectStructure(raw: string): StructureModel | null {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!object(root)) return null;
  const tree = "left" in root || "right" in root || Array.isArray(root.children);
  const linked = "next" in root;
  if (tree || linked) {
    const nodes: StructureNode[] = [];
    const edges: StructureEdge[] = [];
    let partial = false;
    const visit = (value: unknown, id: string, depth: number, parent?: string, relation?: string) => {
      if (value === null || value === undefined) return;
      if (nodes.length >= 60 || depth > 12) {
        partial = true;
        return;
      }
      const isPartial = marker(value);
      if (!object(value) && !isPartial) {
        partial = true;
        return;
      }
      const label = object(value)
        ? summary(value.value ?? value.val ?? value.data ?? value.label ?? value.id ?? "node")
        : summary(value);
      nodes.push({ id, label, depth, parent, relation, partial: isPartial });
      if (parent) edges.push({ from: parent, to: id, label: relation });
      if (isPartial || !object(value)) {
        partial = true;
        return;
      }
      const children = tree
        ? [
            ["left", value.left],
            ["right", value.right],
            ...(Array.isArray(value.children)
              ? value.children.map((child, i) => [`children[${i}]`, child])
              : []),
          ]
        : [["next", value.next]];
      for (const [key, child] of children) visit(child, `${id}.${key}`, depth + 1, id, String(key));
    };
    visit(root, "root", 0);
    return {
      kind: tree ? "tree" : "linked",
      nodes,
      edges,
      ambiguous: true,
      partial,
      explanation: `Interpreted from captured ${tree ? "left/right or children" : "next"} fields. Positions describe connections, not memory addresses or algorithm intent.`,
    };
  }
  const entries = Object.entries(root);
  if (
    entries.length &&
    entries.length <= 60 &&
    entries.every(
      ([, values]) =>
        Array.isArray(values) && values.every((item) => typeof item === "string" || typeof item === "number"),
    )
  ) {
    const ids = new Set(entries.map(([key]) => key));
    // Require every neighbor to be an explicitly captured vertex; never invent missing nodes.
    if (
      !entries.every(([, neighbors]) =>
        (neighbors as unknown[]).every((neighbor) => ids.has(String(neighbor))),
      )
    )
      return null;
    const edges: StructureEdge[] = [];
    for (const [from, neighbors] of entries)
      for (const to of neighbors as unknown[]) {
        if (edges.length < 150) edges.push({ from, to: String(to) });
      }
    return {
      kind: "graph",
      nodes: entries.map(([id]) => ({ id, label: id, depth: 0 })),
      edges,
      ambiguous: true,
      partial: entries.reduce((n, [, neighbors]) => n + (neighbors as unknown[]).length, 0) > 150,
      explanation:
        "Possible adjacency list. Choose graph view only if each key represents a vertex and its list contains outgoing neighbors. Arrows follow the captured lists.",
    };
  }
  return null;
}
