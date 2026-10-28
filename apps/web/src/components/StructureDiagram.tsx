"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { detectStructure } from "@/lib/structures";
export function StructureDiagram({ raw, previous }: { raw: string; previous?: string }) {
  const model = useMemo(() => detectStructure(raw), [raw]);
  const old = useMemo(() => (previous ? detectStructure(previous) : null), [previous]);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(480);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || !viewport.current) return;
    const observer = new ResizeObserver((entries) => setViewportWidth(entries[0].contentRect.width));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [enabled]);
  const arrowId = useId().replaceAll(":", "");
  if (!model?.nodes.length) return null;
  const nodes = model.nodes;
  const levels = new Map<number, typeof nodes>();
  for (const node of nodes) levels.set(node.depth, [...(levels.get(node.depth) ?? []), node]);
  const width = Math.max(
    model.kind === "graph" ? Math.max(420, nodes.length * 25) : 240,
    model.kind === "linked"
      ? nodes.length * 125 + 80
      : Math.max(...[...levels.values()].map((row) => row.length)) * 90 + 30,
  );
  const height =
    model.kind === "graph"
      ? Math.max(430, nodes.length * 25)
      : model.kind === "linked"
        ? 170
        : Math.max(170, levels.size * 110 + 50);
  const scale = Math.min(1, Math.max(240, viewportWidth) / width, 360 / height) * zoom;
  const selectedNode = nodes.find((node) => node.id === selected) ?? nodes[0];
  const neighbors = model.edges.filter(
    (edge) => edge.from === selectedNode.id || edge.to === selectedNode.id,
  );
  const positions = new Map(
    nodes.map((node, i) => {
      if (model.kind === "graph") {
        const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
        return [
          node.id,
          {
            x: width / 2 + Math.cos(angle) * (width / 2 - 60),
            y: height / 2 + Math.sin(angle) * (height / 2 - 60),
          },
        ];
      }
      if (model.kind === "linked") return [node.id, { x: 65 + i * 125, y: 80 }];
      const row = levels.get(node.depth)!;
      return [node.id, { x: ((row.indexOf(node) + 1) / (row.length + 1)) * width, y: 55 + node.depth * 110 }];
    }),
  );
  const changed = new Set(
    nodes
      .filter(
        (node) => old && old.nodes.find((previousNode) => previousNode.id === node.id)?.label !== node.label,
      )
      .map((node) => node.id),
  );
  return (
    <div className="structure-view">
      <label className="toggle-label">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        View captured fields as a {model.kind === "linked" ? "linked structure" : model.kind}
      </label>
      <p className="coverage-note">{model.explanation}</p>
      {enabled && (
        <>
          <div className="diagram-tools">
            <span className="chip">
              {nodes.length} nodes · {model.edges.length} connections
            </span>
            <div role="group" aria-label="Diagram zoom">
              <button
                className="btn"
                aria-label="Zoom out diagram"
                disabled={zoom <= 1}
                onClick={() => setZoom(Math.max(1, zoom / 1.5))}
              >
                −
              </button>
              <button className="btn" onClick={() => setZoom(1)}>
                Fit
              </button>
              <button
                className="btn"
                aria-label="Zoom in diagram"
                disabled={zoom >= 12}
                onClick={() => setZoom(Math.min(12, zoom * 1.5))}
              >
                +
              </button>
            </div>
          </div>
          <div className="diagram-scroll" ref={viewport}>
            <svg
              width={width * scale}
              height={height * scale}
              viewBox={`0 0 ${width} ${height}`}
              role="group"
              aria-label={`${model.kind} interpretation of ${nodes.length} captured nodes`}
            >
              <defs>
                <marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0 0L8 4L0 8Z" fill="#6b9277" />
                </marker>
              </defs>
              {model.edges.map((edge, i) => {
                const from = positions.get(edge.from)!;
                const to = positions.get(edge.to)!;
                const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
                const dx = (to.x - from.x) / distance,
                  dy = (to.y - from.y) / distance;
                return (
                  <g key={i}>
                    {edge.from === edge.to ? (
                      <path
                        d={`M${from.x - 20} ${from.y - 10}C${from.x - 70} ${from.y - 80},${from.x + 70} ${from.y - 80},${from.x + 20} ${from.y - 10}`}
                        fill="none"
                        stroke="#6b9277"
                        markerEnd={`url(#${arrowId})`}
                      />
                    ) : (
                      <line
                        x1={from.x + dx * 28}
                        y1={from.y + dy * 28}
                        x2={to.x - dx * 32}
                        y2={to.y - dy * 32}
                        stroke="#6b9277"
                        strokeWidth="1.6"
                        markerEnd={`url(#${arrowId})`}
                      />
                    )}
                    {edge.label && (
                      <text x={(from.x + to.x) / 2 + 8} y={(from.y + to.y) / 2} fontSize="9" fill="#63746b">
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {nodes.map((node) => {
                const position = positions.get(node.id)!;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${position.x},${position.y})`}
                    className="diagram-node"
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${node.id}: ${node.label}`}
                    aria-pressed={selectedNode.id === node.id}
                    onClick={() => setSelected(node.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(node.id);
                      }
                    }}
                  >
                    <circle
                      r="28"
                      fill={
                        changed.has(node.id) ? "#f7d6c5" : selectedNode.id === node.id ? "#b7dec1" : "#eef5e9"
                      }
                      stroke={node.partial ? "#bd9270" : "#7b9c80"}
                      strokeDasharray={node.partial ? "4 3" : undefined}
                    />
                    <text textAnchor="middle" y="4" fontSize="12" fill="#193328">
                      {node.label.length > 8 ? node.label.slice(0, 8) + "…" : node.label}
                    </text>
                    <title>{`${node.id}: ${node.label}${node.partial ? " (partial snapshot)" : ""}`}</title>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="node-inspector">
            <label>
              Inspect node
              <select
                aria-label="Inspect structure node"
                value={selectedNode.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.id}: {node.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mono">{selectedNode.label}</p>
            <p>
              {neighbors.length} captured {neighbors.length === 1 ? "connection" : "connections"}. Select a
              node or use the selector to inspect it.
            </p>
          </div>
          <p className="coverage-note">
            Mint: captured node · coral: value changed since the previous step · dashed: recorder limit.{" "}
            {model.partial
              ? "This structure is partial; missing connections are not reconstructed."
              : "Diagram is limited to 60 nodes and 150 edges."}
          </p>
        </>
      )}
    </div>
  );
}
