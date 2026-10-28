"use client";
import { useMemo, useState } from "react";
import { parseValueView } from "@/lib/trace-state";
import { compactValue, historyWindow } from "@/lib/replay-insights";
import { Icon } from "./Icon";
import { StructureDiagram } from "./StructureDiagram";
export function ExecutionCanvas({
  variables,
  previous,
  reference,
  stack,
  histories,
  index,
  onSeek,
  activeVariable,
}: {
  variables: Map<string, string>;
  previous: Map<string, string>;
  reference?: Map<string, string>;
  stack: string[];
  histories: Map<string, Array<{ index: number; value: string }>>;
  index: number;
  onSeek: (index: number) => void;
  activeVariable?: string;
}) {
  const [chosen, setChosen] = useState("");
  const [page, setPage] = useState(0);
  const [markers, setMarkers] = useState(false);
  const [variableQuery, setVariableQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [selection, setSelection] = useState<{
    name: string;
    location: string;
    before: string;
    after: string;
    step: number;
  } | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const names = [...variables.keys()];
  const name =
    follow && activeVariable && variables.has(activeVariable)
      ? activeVariable
      : variables.has(chosen)
        ? chosen
        : (names
            .slice(0, 30)
            .find((key) =>
              ["array", "matrix", "object"].includes(parseValueView(variables.get(key)!).kind),
            ) ?? names[0]);
  const choices = names
    .filter((key) => key.toLowerCase().includes(variableQuery.toLowerCase()))
    .slice(0, 200);
  if (name && !choices.includes(name)) choices.unshift(name);
  const raw = name ? variables.get(name)! : "";
  const view = useMemo(() => parseValueView(raw), [raw]);
  const changed = name ? previous.get(name) !== raw : false;
  const history = historyWindow(histories.get(name) ?? [], index);
  const points = history.points;
  const length =
    view.kind === "array"
      ? view.cells.length
      : view.kind === "string"
        ? [...view.text].length
        : view.kind === "matrix"
          ? view.rows.length
          : view.kind === "object"
            ? view.entries.length
            : 1;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(length / 24) - 1));
  const start = currentPage * 24;
  const indexVars = markers
    ? [...variables]
        .filter(([key, value]) => key !== name && /^\d+$/.test(value) && Number(value) < length)
        .slice(0, 8)
    : [];
  const cells = view.kind === "array" ? view.cells : view.kind === "string" ? [...view.text] : [];
  const max =
    view.kind === "array" && view.numbers
      ? view.numbers.reduce((max, value) => Math.max(max, Math.abs(value)), 1)
      : 1;
  const previousRaw = previous.get(name) ?? "";
  const priorView = useMemo(() => parseValueView(previousRaw), [previousRaw]);
  const priorCells =
    priorView.kind === "array" ? priorView.cells : priorView.kind === "string" ? [...priorView.text] : [];
  const numericHistory = (showHistory ? points : [])
    .map((point) => ({ ...point, number: parseValueView(point.value) }))
    .filter(
      (point): point is typeof point & { number: { kind: "scalar"; text: string; number: number } } =>
        point.number.kind === "scalar" && point.number.number !== null,
    );
  const low = numericHistory.length ? Math.min(...numericHistory.map((point) => point.number.number)) : 0;
  const high = numericHistory.length ? Math.max(...numericHistory.map((point) => point.number.number)) : 1;
  return (
    <section className="panel state-lab" aria-label="Recorded execution state">
      <div className="section-heading">
        <div>
          <span className="eyebrow">STATE EXPLORER</span>
          <h2>
            <Icon name="layers" />
            Inside the execution
          </h2>
        </div>
        <span className="chip">Recorded values</span>
      </div>
      {!names.length ? (
        <div className="empty-state">
          <Icon name="layers" size={32} />
          <h3>No variable snapshots at this step</h3>
          <p>Move forward to a recorded assignment. Uncaptured state is not inferred.</p>
        </div>
      ) : (
        <>
          <div className="state-toolbar">
            {names.length > 200 && (
              <input
                type="search"
                aria-label="Find a recorded variable"
                value={variableQuery}
                onChange={(e) => setVariableQuery(e.target.value)}
                placeholder="Find a variable…"
              />
            )}
            <label>
              Inspect{" "}
              <select
                aria-label="Inspect variable"
                value={name}
                onChange={(e) => {
                  setChosen(e.target.value);
                  setFollow(false);
                  setPage(0);
                }}
              >
                {choices.map((key) => (
                  <option key={key} value={key}>
                    {compactValue(key,80)}
                  </option>
                ))}
              </select>
            </label>
            <span className="chip">{view.kind}</span>
            <span className={`chip ${changed ? "chip-accepted" : ""}`}>
              {changed ? "Updated this step" : "Unchanged"}
            </span>
            <label className="toggle-label">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              Follow updates
            </label>
          </div>
          <div className="value-stage">
            <div className="value-heading">
              <strong className="mono">{compactValue(name??"",80)}</strong>
              <span>
                {view.kind === "scalar"
                  ? `${history.count} recorded updates`
                  : `${length} ${view.kind === "matrix" ? "rows" : view.kind === "object" ? "fields" : "items"}`}
              </span>
            </div>
            {(view.kind === "array" || view.kind === "string") && (
              <>
                <div className="cell-grid">
                  {cells.slice(start, start + 24).map((cell, offset) => {
                    const i = start + offset;
                    const number = view.kind === "array" ? view.numbers?.[i] : undefined;
                    const labels = indexVars.filter(([, value]) => Number(value) === i).map(([key]) => key);
                    return (
                      <button
                        type="button"
                        aria-label={`${name}[${i}] is ${compactValue(cell, 80)}${priorCells[i] !== undefined ? `, previously ${compactValue(priorCells[i], 80)}` : "; no previous captured value"}`}
                        aria-pressed={
                          selection?.name === name &&
                          selection.location === `[${i}]` &&
                          selection.step === index
                        }
                        onClick={() =>
                          setSelection({
                            name,
                            location: `[${i}]`,
                            before: priorCells[i] ?? "Not captured",
                            after: cell,
                            step: index,
                          })
                        }
                        className={`state-cell ${number !== undefined && number < 0 ? "negative" : ""} ${previous.has(name) && priorCells[i] !== cell ? "cell-updated" : ""}`}
                        key={i}
                      >
                        <span className="cell-index">{i}</span>
                        {number !== undefined && (
                          <div className="bar-track" aria-hidden="true">
                            <span style={{ height: `${Math.max(4, (Math.abs(number) / max) * 100)}%` }} />
                          </div>
                        )}
                        <strong className="mono" title={cell}>
                          {cell === " " ? "␣" : compactValue(cell || "∅", 80)}
                        </strong>
                        {labels.length > 0 && <span className="index-marker">{labels.join(", ")}</span>}
                      </button>
                    );
                  })}
                </div>
                {!cells.length && <p className="muted">Empty {view.kind}.</p>}
                {view.kind === "array" && view.truncated && (
                  <p className="coverage-note">
                    Snapshot truncated by the recorder. Only captured cells are shown.
                  </p>
                )}
                {view.kind === "array" && (
                  <label className="toggle-label">
                    <input type="checkbox" checked={markers} onChange={(e) => setMarkers(e.target.checked)} />
                    Overlay integer variables as indices <span className="muted">(inspection aid)</span>
                  </label>
                )}
              </>
            )}
            {view.kind === "matrix" && (
              <div className="table-scroll">
                <table className="state-table">
                  <tbody>
                    {view.rows.slice(start, start + 24).map((row, r) => (
                      <tr key={r}>
                        <th scope="row">row {start + r}</th>
                        {row.slice(0, 24).map((cell, c) => (
                          <td
                            className={`mono ${priorView.kind === "matrix" && priorView.rows[start + r]?.[c] !== cell ? "matrix-updated" : ""}`}
                            key={c}
                            title={`[${start + r}][${c}]`}
                          >
                            <button
                              type="button"
                              aria-label={`${name}[${start + r}][${c}] is ${compactValue(cell, 80)}`}
                              onClick={() =>
                                setSelection({
                                  name,
                                  location: `[${start + r}][${c}]`,
                                  before:
                                    priorView.kind === "matrix"
                                      ? (priorView.rows[start + r]?.[c] ?? "Not captured")
                                      : "Not captured",
                                  after: cell,
                                  step: index,
                                })
                              }
                            >
                              {compactValue(cell, 80)}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {view.rows.some((row) => row.length > 24) && (
                  <p className="muted">First 24 columns shown. Complete captured value is available below.</p>
                )}
              </div>
            )}
            {view.kind === "object" && (
              <>
                <StructureDiagram raw={raw} previous={previous.get(name)} />
                <dl className="object-grid">
                  {view.entries.slice(start, start + 24).map(([key, value]) => (
                    <div key={key}>
                      <dt className="mono">{key}</dt>
                      <dd className="mono" title={value}>
                        {compactValue(value, 180)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {view.kind === "scalar" && (
              <div className={`scalar-display ${changed ? "changed" : ""}`}>
                <strong className="mono">{compactValue(view.text, 180)}</strong>
                <span>
                  {previous.has(name) && previous.get(name) !== raw
                    ? `Previously ${compactValue(previous.get(name) ?? "", 120)}`
                    : "Value at the selected step"}
                </span>
              </div>
            )}
            {selection?.name === name && selection.step === index && (
              <div className="cell-inspector" role="status">
                <strong className="mono">
                  {name}
                  {selection.location}
                </strong>
                <span>
                  <span className="muted">Previous </span>
                  <code>{compactValue(selection.before, 120)}</code>
                </span>
                <span>
                  <span className="muted">Current </span>
                  <code>{compactValue(selection.after, 120)}</code>
                </span>
              </div>
            )}
            {length > 24 && (
              <div className="pagination">
                <button className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                  Previous
                </button>
                <span>
                  {start + 1}–{Math.min(length, start + 24)} of {length}
                </span>
                <button
                  className="btn"
                  disabled={start + 24 >= length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            )}
            <details className="raw-value" onToggle={(event) => setShowRaw(event.currentTarget.open)}>
              <summary>Captured serialized value</summary>
              {showRaw && <pre>{raw}</pre>}
            </details>
          </div>
          <details className="history-strip" onToggle={(event) => setShowHistory(event.currentTarget.open)}>
            <summary>Variable history · {history.count} recorded updates</summary>
            {showHistory && (
              <>
                <div className="section-heading">
                  <h3>Variable history</h3>
                  <span className="muted">
                    Latest {points.length} updates by name across calls · click to seek
                  </span>
                </div>
                {numericHistory.length > 1 && (
                  <figure className="history-chart">
                    <svg
                      viewBox="0 0 600 110"
                      role="img"
                      aria-label={`Recorded numeric history of ${name}, minimum ${low}, maximum ${high}`}
                    >
                      <path d="M20 90H580" stroke="#d0ddcd" />
                      <polyline
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.5"
                        points={numericHistory
                          .map(
                            (point, i) =>
                              `${20 + (i / (numericHistory.length - 1)) * 560},${90 - ((point.number.number - low) / (high - low || 1)) * 70}`,
                          )
                          .join(" ")}
                      />
                      {numericHistory.map((point, i) => (
                        <circle
                          key={point.index}
                          cx={20 + (i / (numericHistory.length - 1)) * 560}
                          cy={90 - ((point.number.number - low) / (high - low || 1)) * 70}
                          r="4"
                          fill="var(--accent)"
                        >
                          <title>{`Step ${point.index + 1}: ${point.value}`}</title>
                        </circle>
                      ))}
                    </svg>
                    <figcaption>
                      Recorded update order · {low} to {high}. Equal spacing shows updates, not elapsed time.
                    </figcaption>
                  </figure>
                )}
                <div className="history-points">
                  {points.map((point) => (
                    <button
                      className="history-point mono"
                      key={point.index}
                      onClick={() => onSeek(point.index)}
                      aria-label={`${name} equals ${point.value}, go to step ${point.index + 1}`}
                    >
                      <span>{point.index + 1}</span>
                      <strong>
                        {point.value.length > 24 ? point.value.slice(0, 24) + "…" : point.value}
                      </strong>
                    </button>
                  ))}
                </div>
              </>
            )}
          </details>
          <details className="all-variables" onToggle={(event) => setShowAll(event.currentTarget.open)}>
            <summary>
              All recorded variables ({names.length}){reference ? " · compare with reference" : ""}
            </summary>
            {showAll && (
              <>
                <div className="table-scroll">
                  <table className="state-table">
                    <thead>
                      <tr>
                        <th>Variable</th>
                        <th>Your value</th>
                        {reference && <th>Reference value</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {[...variables].slice(0, 200).map(([key, value]) => (
                        <tr
                          key={key}
                          className={reference?.has(key) && reference.get(key) !== value ? "diff-row" : ""}
                        >
                          <th scope="row" className="mono">
                            {key}
                          </th>
                          <td className="mono">{value}</td>
                          {reference && <td className="mono">{reference.get(key) ?? "Not captured"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {names.length > 200 && (
                  <p className="muted">
                    Table limited to 200 variables. Inspect any variable using the selector.
                  </p>
                )}
              </>
            )}
          </details>
        </>
      )}
      <div className="call-stack">
        <span className="eyebrow">RECORDED CALL STACK</span>
        <div>
          {stack.length ? (
            stack.slice(-20).map((fn, i) => (
              <span className="stack-frame mono" key={`${i}-${fn}`}>
                {fn}()
              </span>
            ))
          ) : (
            <span className="muted">No active recorded call</span>
          )}
        </div>
        {stack.length > 20 && <span className="muted">Latest 20 of {stack.length} frames</span>}
      </div>
    </section>
  );
}
