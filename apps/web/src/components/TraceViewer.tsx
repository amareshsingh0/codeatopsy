"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Divergence, Language, Trace } from "@codeautopsy/schemas";
import { CodeEditor } from "./CodeEditor";

interface Props {
  studentSource: string;
  referenceSource?: string;
  language?: Language;
  studentTrace: Trace;
  referenceTrace?: Trace | null;
  pairs?: Array<{ s: number; r: number }>;
  divergence?: Divergence | null;
  /** program stdout for the selected run (shown in the output panel) */
  output?: string | null;
}

const KIND_COLOR: Record<string, string> = {
  assign: "var(--accent)",
  branch: "var(--warn)",
  call: "var(--accent-2)",
  line: "#9d7bff",
  return: "var(--accent-2)",
  returnvoid: "var(--accent-2)",
  output: "var(--muted)",
};

const KIND_LABEL: Record<string, string> = {
  assign: "assignment",
  branch: "condition",
  call: "call",
  line: "statement",
  return: "return",
  returnvoid: "return",
  output: "output",
};

const MARKER_VARS = new Set(["left", "lo", "low", "right", "hi", "high", "mid", "l", "r"]);

type ParsedValue =
  | { kind: "grid"; rows: string[][] }
  | { kind: "array"; cells: string[]; numbers: number[] | null }
  | { kind: "string"; chars: string }
  | { kind: "scalar"; text: string };

function parseValue(v: string | undefined): ParsedValue {
  if (v === undefined) return { kind: "scalar", text: "?" };
  if (v.startsWith("[[")) {
    try {
      const rows = (JSON.parse(v) as unknown[][]).map((r) => r.map((c) => String(c)));
      if (rows.length && rows.every((r) => Array.isArray(r) && r.length > 0)) {
        return { kind: "grid", rows };
      }
    } catch {
      /* fall through */
    }
  }
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1);
    const cells = inner === "" ? [] : inner.split(",").map((s) => s.trim());
    const numbers = cells.every((c) => /^-?\d+(\.\d+)?$/.test(c))
      ? cells.map((c) => Number(c))
      : null;
    return { kind: "array", cells, numbers };
  }
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return { kind: "string", chars: v.slice(1, -1) };
  }
  return { kind: "scalar", text: v };
}

function snapshotVars(events: Trace["events"], uptoInclusive: number): Map<string, string> {
  const m = new Map<string, string>();
  for (let k = 0; k <= uptoInclusive && k < events.length; k++) {
    const e = events[k];
    if (e.kind === "assign" && e.name) m.set(e.name, e.value ?? "?");
  }
  return m;
}

export function TraceViewer({
  studentSource,
  referenceSource = "",
  language,
  studentTrace,
  referenceTrace = null,
  pairs = [],
  divergence = null,
  output = null,
}: Props) {
  const events = studentTrace.events;
  const hasRef = !!(referenceTrace && referenceTrace.events.length > 0 && referenceSource);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [showRef, setShowRef] = useState(true);

  const lastSeq = Math.max(0, events.length - 1);

  useEffect(() => {
    setIdx(divergence ? Math.min(divergence.studentSeq, lastSeq) : lastSeq);
    setPlaying(false);
  }, [studentTrace, divergence, lastSeq]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIdx((i) => {
        if (i >= lastSeq) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(t);
  }, [playing, speed, lastSeq]);

  // keyboard transport: ←/→ step, space play/pause, Home/End jump
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        setPlaying(false);
        setIdx((i) => Math.min(lastSeq, i + 1));
      } else if (e.key === "ArrowLeft") {
        setPlaying(false);
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Home") {
        setPlaying(false);
        setIdx(0);
      } else if (e.key === "End") {
        setPlaying(false);
        setIdx(lastSeq);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lastSeq]);

  const refIdx = useMemo(() => {
    if (!hasRef) return 0;
    let r = 0;
    for (const p of pairs) {
      if (p.s <= idx) r = Math.max(r, p.r);
      else break;
    }
    return r;
  }, [pairs, idx, hasRef]);

  const current = events[idx];

  const { variables, changed, callStack, prevVars } = useMemo(() => {
    const vars = new Map<string, string>();
    const stack: string[] = [];
    for (let k = 0; k <= Math.min(idx, lastSeq); k++) {
      const e = events[k];
      if (e.kind === "assign" && e.name) vars.set(e.name, e.value ?? "?");
      else if (e.kind === "call" && e.fn) stack.push(e.fn);
      else if ((e.kind === "return" || e.kind === "returnvoid") && stack.length) stack.pop();
    }
    const prev = idx > 0 ? snapshotVars(events, idx - 1) : new Map<string, string>();
    const ch = new Set<string>();
    if (current?.kind === "assign" && current.name) ch.add(current.name);
    return { variables: vars, changed: ch, callStack: stack, prevVars: prev };
  }, [idx, events, lastSeq, current]);

  const stepText = useMemo(() => {
    if (!current) return "";
    const was = (name: string) => {
      const p = prevVars.get(name);
      return p !== undefined && p !== variables.get(name) ? ` (was ${p})` : "";
    };
    switch (current.kind) {
      case "assign":
        return `line ${current.line} · ${current.name} = ${current.value}${was(current.name ?? "")}`;
      case "branch":
        return `line ${current.line} · condition "${current.cond}" evaluated to ${current.taken ? "true" : "false"}`;
      case "call":
        return `line ${current.line} · entering function ${current.fn}()`;
      case "line":
        return `line ${current.line} · statement executed in ${current.fn}()`;
      case "return":
        return `line ${current.line} · ${current.fn}() returned ${current.value}`;
      case "returnvoid":
        return `line ${current.line} · ${current.fn}() returned`;
      default:
        return `line ${current.line} · ${current.kind}`;
    }
  }, [current, prevVars, variables]);

  const jumpTo = useCallback(
    (n: number) => {
      setPlaying(false);
      setIdx(Math.max(0, Math.min(lastSeq, n)));
    },
    [lastSeq],
  );

  const kindColor = current ? KIND_COLOR[current.kind] ?? "var(--muted)" : "var(--muted)";

  return (
    <div className="grid gap-4">
      {/* ---------- transport ---------- */}
      <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button className="btn" title="Start (Home)" onClick={() => jumpTo(0)} disabled={!events.length}>⏮</button>
          <button className="btn" title="Step back (←)" onClick={() => jumpTo(idx - 1)} disabled={!events.length}>◀</button>
          <button
            className={`btn ${playing ? "" : "btn-accent2"}`}
            title="Play/Pause (Space)"
            onClick={() => {
              if (!playing && idx >= lastSeq) setIdx(0);
              setPlaying((p) => !p);
            }}
            disabled={!events.length}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button className="btn" title="Step forward (→)" onClick={() => jumpTo(idx + 1)} disabled={!events.length}>▶</button>
          <button className="btn" title="End (End)" onClick={() => jumpTo(lastSeq)} disabled={!events.length}>⏭</button>
        </div>

        <div className="mono text-xs" style={{ color: "var(--muted)" }}>
          step <b style={{ color: "var(--text)" }}>{events.length ? idx + 1 : 0}</b>/{events.length}
        </div>

        {divergence && (
          <button
            className="btn"
            style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
            onClick={() => jumpTo(divergence.studentSeq)}
          >
            ⚡ Divergence
          </button>
        )}

        {studentTrace.meta.truncated && (
          <span className="chip chip-timeout">⚠ trace truncated (loop too long)</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasRef && (
            <button className="btn" onClick={() => setShowRef((s) => !s)}>
              {showRef ? "eye: A/B" : "eye-off: A/B"}
            </button>
          )}
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            speed
            <select
              className="mono rounded-md border bg-transparent px-2 py-1 text-xs"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[2, 4, 8, 16, 32].map((s) => (
                <option key={s} value={s}>{s}×/s</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* ---------- scrubber + timeline + step description ---------- */}
      <div className="panel px-4 py-3">
        <input
          type="range"
          className="scrubber w-full"
          min={0}
          max={lastSeq}
          value={Math.min(idx, lastSeq)}
          onChange={(e) => jumpTo(Number(e.target.value))}
          aria-label="Trace position"
        />
        <div className="scroll-thin mt-3 flex gap-[2px] overflow-x-auto pb-1">
          {events.map((e, k) => (
            <button
              key={e.seq}
              title={`#${e.seq + 1} ${KIND_LABEL[e.kind] ?? e.kind}${e.name ? ` ${e.name}` : ""}${e.value ? ` = ${e.value}` : ""}${e.cond ? ` → ${e.taken}` : ""} (line ${e.line})`}
              onClick={() => jumpTo(k)}
              className="h-4 w-[7px] shrink-0 rounded-[2px] border-0"
              style={{
                background: k <= idx ? KIND_COLOR[e.kind] ?? "var(--muted)" : "var(--border)",
                outline:
                  k === idx
                    ? "2px solid #fff"
                    : divergence && e.seq === divergence.studentSeq
                      ? "2px solid var(--danger)"
                      : "none",
              }}
            />
          ))}
        </div>
        {current && (
          <div className="mt-2 flex items-center gap-2">
            <span
              className="chip text-[10px]"
              style={{ color: kindColor, borderColor: kindColor }}
            >
              {KIND_LABEL[current.kind] ?? current.kind}
            </span>
            <span className="mono text-xs" style={{ color: "var(--text)" }}>
              {stepText}
            </span>
          </div>
        )}
        <div className="mt-2 hidden flex-wrap gap-2 sm:flex">
          {Object.entries(KIND_LABEL)
            .filter(([k], i, arr) => arr.findIndex(([, v]) => v === KIND_LABEL[k]) === i)
            .map(([k, label]) => (
              <span key={k} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--muted)" }}>
                <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: KIND_COLOR[k] }} />
                {label}
              </span>
            ))}
        </div>
      </div>

      {/* ---------- editors ---------- */}
      <div className={`grid gap-4 ${hasRef && showRef ? "lg:grid-cols-2" : ""}`}>
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="text-[13px] font-bold" style={{ color: "var(--accent)" }}>
              {hasRef && showRef ? "A · your execution" : "Execution"}
            </span>
            <span className="mono text-xs" style={{ color: "var(--muted)" }}>
              {current ? `line ${current.line}` : ""}
            </span>
          </div>
          <CodeEditor value={studentSource} language={language} currentLine={current?.line ?? null} markerLine={divergence?.studentLine ?? null} height="300px" />
        </div>
        {hasRef && showRef && (
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="text-[13px] font-bold" style={{ color: "var(--accent-2)" }}>B · reference execution</span>
              <span className="mono text-xs" style={{ color: "var(--muted)" }}>
                {referenceTrace!.events[refIdx] ? `line ${referenceTrace!.events[refIdx].line}` : ""}
              </span>
            </div>
            <CodeEditor
              value={referenceSource}
              language={language}
              currentLine={referenceTrace!.events[refIdx]?.line ?? null}
              markerLine={divergence?.referenceLine ?? null}
              height="300px"
            />
          </div>
        )}
      </div>

      {/* ---------- state panels ---------- */}
      <div className={`grid gap-4 ${hasRef && showRef ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <div className={`panel p-4 ${hasRef && showRef ? "lg:col-span-3" : "lg:col-span-2"}`}>
          <h3 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Variables <span className="normal-case" style={{ fontWeight: 400 }}>— green = changed this step</span>
          </h3>
          <div className="mt-3 grid gap-2.5">
            {variables.size === 0 && (
              <p className="text-xs" style={{ color: "var(--muted)" }}>No assignments executed yet — press ▶ or → to step.</p>
            )}
            {[...variables.entries()].map(([name, value]) => (
              <VariableRow
                key={name}
                name={name}
                value={value}
                prevValue={prevVars.get(name)}
                changed={changed.has(name)}
                variables={variables}
              />
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Call stack
          </h3>
          <div className="mt-3 grid gap-1">
            {callStack.length === 0 && (
              <p className="text-xs" style={{ color: "var(--muted)" }}>Top-level scope.</p>
            )}
            {[...callStack].reverse().map((fn, i) => (
              <div
                key={`${fn}-${i}`}
                className="mono rounded-md px-2 py-1 text-[13px]"
                style={{
                  background: i === 0 ? "color-mix(in srgb, var(--accent-2) 14%, transparent)" : "var(--panel-2)",
                  marginLeft: `${i * 10}px`,
                }}
              >
                {fn}()
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- program output ---------- */}
      {output !== null && output !== "" && (
        <div className="panel p-4">
          <h3 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Program output (stdout)
          </h3>
          <pre className="mono scroll-thin mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-relaxed" style={{ background: "var(--panel-2)" }}>
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ---------------- variable rendering ---------------- */

function VariableRow({
  name,
  value,
  prevValue,
  changed,
  variables,
}: {
  name: string;
  value: string;
  prevValue: string | undefined;
  changed: boolean;
  variables: Map<string, string>;
}) {
  const parsed = parseValue(value);

  return (
    <div
      className="rounded-lg px-2 py-1.5 transition-colors duration-300"
      style={{ background: changed ? "color-mix(in srgb, var(--accent-2) 10%, transparent)" : "transparent" }}
    >
      <div className="mono flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span style={{ color: "var(--accent)" }}>{name}</span>
        {changed && prevValue !== undefined && (
          <span className="text-[11px] line-through" style={{ color: "var(--muted)" }}>{prevValue}</span>
        )}
        <span className="font-semibold" style={{ color: changed ? "var(--accent-2)" : "var(--text)" }}>
          {parsed.kind === "array" ? `[${parsed.cells.length}]` : parsed.kind === "grid" ? "matrix" : parsed.kind === "string" ? `"${parsed.chars}"` : parsed.text}
        </span>
        {changed && <span className="text-[10px] font-bold uppercase" style={{ color: "var(--accent-2)" }}>changed</span>}
      </div>

      {parsed.kind === "array" && parsed.cells.length > 0 && (
        <ArrayViz cells={parsed.cells} numbers={parsed.numbers} markers={MARKER_VARS.has(name) ? collectMarkers(variables) : []} />
      )}
      {parsed.kind === "grid" && <GridViz rows={parsed.rows} />}
      {parsed.kind === "string" && parsed.chars.length > 0 && parsed.chars.length <= 60 && (
        <div className="scroll-thin mt-1 flex overflow-x-auto">
          {parsed.chars.split("").map((c, i) => (
            <div key={i} className="mono mr-[3px] rounded border px-1.5 py-0.5 text-xs" style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}>
              {c === " " ? "␣" : c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function collectMarkers(variables: Map<string, string>): Array<{ name: string; index: number | null }> {
  const out: Array<{ name: string; index: number | null }> = [];
  for (const [name, value] of variables) {
    if (!MARKER_VARS.has(name)) continue;
    const v = parseValue(value);
    if (v.kind !== "scalar") continue;
    const n = /^-?\d+$/.test(v.text) ? Number(v.text) : null;
    out.push({ name, index: n });
  }
  return out;
}

function ArrayViz({
  cells,
  numbers,
  markers,
}: {
  cells: string[];
  numbers: number[] | null;
  markers: Array<{ name: string; index: number | null }>;
}) {
  if (cells.length > 40) {
    return (
      <div className="mono mt-1 text-xs" style={{ color: "var(--muted)" }}>
        [{cells.length} elements — first 40 shown]
      </div>
    );
  }
  const maxAbs = numbers ? Math.max(1, ...numbers.map((n) => Math.abs(n))) : 1;
  return (
    <div className="scroll-thin mt-1.5 flex items-end gap-[3px] overflow-x-auto pb-1">
      {cells.map((cell, i) => {
        const marker = markers.find((m) => m.index === i);
        const num = numbers?.[i] ?? null;
        const h = num !== null ? Math.max(6, Math.round((Math.abs(num) / maxAbs) * 34)) : null;
        return (
          <div key={i} className="shrink-0 text-center">
            {marker && (
              <div className="mono text-[10px] font-bold leading-3" style={{ color: "var(--accent-2)" }}>
                ↑{marker.name}
              </div>
            )}
            <div className="flex h-[36px] items-end">
              {h !== null && (
                <div
                  className="w-full rounded-t-[3px] transition-all duration-200"
                  style={{
                    height: `${h}px`,
                    background: marker ? "var(--accent-2)" : "color-mix(in srgb, var(--accent) 65%, transparent)",
                  }}
                />
              )}
            </div>
            <div
              className="mono rounded-md border px-1.5 py-0.5 text-[11px] transition-colors duration-200"
              style={{
                borderColor: marker ? "var(--accent-2)" : "var(--border)",
                background: marker ? "color-mix(in srgb, var(--accent-2) 14%, transparent)" : "var(--panel-2)",
                minWidth: "30px",
              }}
            >
              {cell}
            </div>
            <div className="text-[9px]" style={{ color: "var(--muted)" }}>{i}</div>
          </div>
        );
      })}
    </div>
  );
}

function GridViz({ rows }: { rows: string[][] }) {
  if (rows.length > 15 || rows.some((r) => r.length > 15)) {
    return <div className="mono mt-1 text-xs" style={{ color: "var(--muted)" }}>{rows.length}×{rows[0]?.length ?? 0} matrix</div>;
  }
  return (
    <div className="mt-1.5 inline-block">
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-[3px] pb-[3px]">
          {row.map((cell, ci) => (
            <div
              key={ci}
              className="mono rounded border px-1.5 py-0.5 text-center text-[11px]"
              style={{ borderColor: "var(--border)", background: "var(--panel-2)", minWidth: "32px" }}
            >
              {cell}
            </div>
          ))}
        </div>
      ))}
      <div className="text-[9px]" style={{ color: "var(--muted)" }}>
        {rows.length}×{rows[0]?.length ?? 0}
      </div>
    </div>
  );
}
