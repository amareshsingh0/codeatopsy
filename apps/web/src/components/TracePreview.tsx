"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./Icon";
// Small, explicit teaching simulations. These are not submitted-program traces.
const TOPICS = [
  { id: "arrays", label: "Changing a list", steps: 3 },
  { id: "graphs", label: "Exploring a graph", steps: 4 },
  { id: "dynamic-programming", label: "Building a DP table", steps: 9 },
] as const;
const LISTS = [
  [3, 1, 4],
  [3, 9, 4],
  [3, 9, 4, 2],
];
const GRID = [1, 1, 1, 1, 2, 3, 1, 3, 6];
const NODES = [
  { id: "A", x: 65, y: 90 },
  { id: "B", x: 215, y: 40 },
  { id: "C", x: 215, y: 140 },
  { id: "D", x: 365, y: 90 },
];
export function TracePreview() {
  const [topic, setTopic] = useState<(typeof TOPICS)[number]>(TOPICS[0]);
  const [step, setStep] = useState(0);
  const last = step === topic.steps - 1;
  return (
    <section className="preview-lab concept-preview" aria-label="Interactive concept preview">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SMALL IDEAS. VISIBLE MOMENTS.</span>
          <h2>Try a little “aha”.</h2>
        </div>
        <span className="chip">Illustrative simulation</span>
      </div>
      <div className="concept-tabs" role="group" aria-label="Choose a preview concept">
        {TOPICS.map((item) => (
          <button
            key={item.id}
            className={`btn ${topic.id === item.id ? "btn-primary" : ""}`}
            aria-pressed={topic.id === item.id}
            onClick={() => {
              setTopic(item);
              setStep(0);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="concept-scene">
        {topic.id === "arrays" && (
          <div className="preview-cells">
            {LISTS[step].map((value, i) => (
              <div
                className={`preview-cell ${(step === 1 && i === 1) || (step === 2 && i === 3) ? "active" : ""}`}
                key={i}
              >
                <span>index {i}</span>
                <strong className="mono">{value}</strong>
                <span>
                  {step === 1 && i === 1 ? "1 → 9" : step === 2 && i === 3 ? "new item" : "position"}
                </span>
              </div>
            ))}
          </div>
        )}
        {topic.id === "graphs" && (
          <div className="graph-preview">
            <svg
              viewBox="0 0 430 185"
              role="img"
              aria-label={`Illustrative breadth-first visit order: ${NODES.slice(0, step + 1)
                .map((node) => node.id)
                .join(", ")}`}
            >
              {[
                [0, 1],
                [0, 2],
                [1, 3],
                [2, 3],
              ].map(([a, b], i) => (
                <path
                  key={i}
                  d={`M${NODES[a].x} ${NODES[a].y}L${NODES[b].x} ${NODES[b].y}`}
                  fill="none"
                  stroke="#a5c4b1"
                  strokeWidth="3"
                />
              ))}
              {NODES.map((node, i) => (
                <g key={node.id}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="24"
                    fill={i === step ? "#f5cbb4" : i < step ? "#c7e6d0" : "white"}
                    stroke="#4d8669"
                    strokeWidth="2"
                  />
                  <text x={node.x} y={node.y + 5} textAnchor="middle" fill="#193328" fontSize="16">
                    {node.id}
                  </text>
                </g>
              ))}
            </svg>
            <p className="mono">
              Visited:{" "}
              {NODES.slice(0, step + 1)
                .map((node) => node.id)
                .join(" → ")}
            </p>
          </div>
        )}
        {topic.id === "dynamic-programming" && (
          <div
            className="dp-preview"
            role="table"
            aria-label="Illustrative paths table, one cell revealed per step"
          >
            {[0, 1, 2].map((row) => (
              <div role="row" key={row}>
                {[0, 1, 2].map((col) => {
                  const i = row * 3 + col;
                  const above = step >= 3 && i === step - 3;
                  const left = step % 3 > 0 && i === step - 1;
                  return (
                    <div
                      role="cell"
                      key={i}
                      className={`${i === step ? "active" : ""} ${above || left ? "dependency" : ""}`}
                    >
                      <span>
                        [{row}][{col}]
                      </span>
                      <strong>{i <= step ? GRID[i] : "·"}</strong>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="preview-bottom">
        <div>
          <span className="eyebrow">
            STEP {step + 1} / {topic.steps}
          </span>
          <p>
            {topic.id === "arrays"
              ? [
                  "A list keeps values in numbered positions.",
                  "Only index 1 changes. The other values stay put.",
                  "Appending adds a new position at the end.",
                ][step]
              : topic.id === "graphs"
                ? `Visit ${NODES[step].id}. In this breadth-first example, A's neighbors come before D.`
                : step === 8
                  ? "The last cell has 6 paths. Each interior cell adds the value above and to its left."
                  : `Fill [${Math.floor(step / 3)}][${step % 3}]. Boundary cells have 1 path; interior cells add above + left.`}
          </p>
        </div>
        <button className="btn" onClick={() => setStep(last ? 0 : step + 1)}>
          {last ? "Replay concept" : "Next step"}
          <Icon name="arrow" />
        </button>
      </div>
      <div className="preview-footer">
        <p className="coverage-note">
          Illustrative examples. Your real replay is always built from execution data.
        </p>
        <Link href={`/playground?example=${topic.id}`}>
          Try the real program <Icon name="arrow" size={15} />
        </Link>
      </div>
    </section>
  );
}
