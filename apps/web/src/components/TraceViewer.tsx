"use client";
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Divergence, Language, Trace } from "@codeautopsy/schemas";
import { createTraceIndex, timelineBuckets } from "@/lib/trace-state";
import { compactValue, createReplayNavigation, upperBound } from "@/lib/replay-insights";
import { SourceWalkthrough } from "./SourceWalkthrough";
import { ExecutionCanvas } from "./ExecutionCanvas";
import { Icon } from "./Icon";
import { LearnStep } from "./LearnStep";
import { PredictionCheck } from "./PredictionCheck";
const CodeEditor = dynamic(() => import("./CodeEditor").then((module) => module.CodeEditor));
interface Props {
  studentSource: string;
  referenceSource?: string;
  language?: Language;
  studentTrace: Trace;
  referenceTrace?: Trace | null;
  pairs?: Array<{ s: number; r: number }>;
  divergence?: Divergence | null;
  output?: string | null;
  active?: boolean;
  onReady?: () => void;
}
const COLORS: Record<string, string> = {
  assign: "var(--accent)",
  branch: "var(--warn)",
  call: "#6f70b5",
  line: "#8a9b93",
  return: "#6f70b5",
  returnvoid: "#6f70b5",
  output: "#438ca0",
};
class VisualBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="panel p-5" role="alert">
        This state could not be visualized. Source, event log and program output remain available.
      </div>
    ) : (
      this.props.children
    );
  }
}
export function TraceViewer({
  studentSource,
  referenceSource = "",
  language,
  studentTrace,
  referenceTrace,
  pairs = [],
  divergence,
  output,
  active = true,
  onReady,
}: Props) {
  const events = studentTrace.events;
  const last = Math.max(0, events.length - 1);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSource, setShowSource] = useState(false);
  const [showReference, setShowReference] = useState(true);
  const [referenceCursor, setReferenceCursor] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [learn, setLearn] = useState(true);
  const [layout, setLayout] = useState("balanced");
  const [density, setDensity] = useState("comfortable");
  const [mobileView, setMobileView] = useState("visual");
  const [showLog, setShowLog] = useState(false);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
  }, [active, onReady]);
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("codeautopsy:replay-display") ?? "{}");
      if (["balanced", "visual"].includes(saved.layout)) setLayout(saved.layout);
      if (["comfortable", "compact"].includes(saved.density)) setDensity(saved.density);
    } catch {
      /* Preferences are optional; private browsing remains functional. */
    }
  }, []);
  const displayPreference = (nextLayout: string, nextDensity: string) => {
    setLayout(nextLayout);
    setDensity(nextDensity);
    try {
      localStorage.setItem(
        "codeautopsy:replay-display",
        JSON.stringify({ layout: nextLayout, density: nextDensity }),
      );
    } catch {
      /* In-memory preferences still work. */
    }
  };
  const stateIndex = useMemo(() => createTraceIndex(events), [events]);
  const navigation = useMemo(() => createReplayNavigation(events), [events]);
  const refEvents = referenceTrace?.events;
  const referenceIndex = useMemo(() => createTraceIndex(refEvents ?? []), [refEvents]);
  const buckets = useMemo(() => timelineBuckets(events), [events]);
  const hasReference = !!refEvents?.length && !!referenceSource;
  useEffect(() => {
    setIndex(Math.max(0, Math.min(divergence?.studentSeq ?? 0, last)));
    setPlaying(false);
    setReferenceCursor(null);
    setPage(0);
  }, [studentTrace, divergence, last]);
  const seek = useCallback(
    (value: number) => {
      setPlaying(false);
      setIndex(Math.max(0, Math.min(last, value)));
    },
    [last],
  );
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setIndex((current) => {
          if (current >= last) {
            setPlaying(false);
            return current;
          }
          return current + 1;
        }),
      1000 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, last, speed]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  const onKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (
      (event.target as HTMLElement).closest(
        "input, textarea, select, button, summary, [contenteditable=true]",
      )
    )
      return;
    const keys: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: last };
    if (event.key in keys) {
      event.preventDefault();
      seek(keys[event.key]);
    }
    if (event.key === " ") {
      event.preventDefault();
      setPlaying((value) => !value);
    }
  };
  const referencePositions = useMemo(() => pairs.map((pair) => pair.s), [pairs]);
  const alignedReference = pairs[upperBound(referencePositions, index) - 1]?.r ?? 0;
  const refIndex = referenceCursor ?? alignedReference;
  const state = useMemo(() => stateIndex.snapshot(index), [stateIndex, index]);
  const previous = useMemo(() => stateIndex.snapshot(index - 1), [stateIndex, index]);
  const refState = useMemo(() => referenceIndex.snapshot(refIndex), [referenceIndex, refIndex]);
  const current = events[index];
  const rows = useMemo(
    () =>
      (showLog ? events : [])
        .map((event, i) => ({ event, i }))
        .filter(
          ({ event, i }) =>
            (filter === "all" || event.kind === filter) &&
            (!query ||
              `${i + 1} ${event.line} ${event.name ?? ""} ${event.fn ?? ""} ${event.value ?? ""} ${event.cond ?? ""}`
                .toLowerCase()
                .includes(query.toLowerCase())),
        ),
    [events, filter, query, showLog],
  );
  const rowPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 30) - 1));
  const description = current
    ? current.kind === "assign"
      ? `${compactValue(current.name??"value",80)} = ${compactValue(current.value ?? "?", 120)}`
      : current.kind === "branch"
        ? `${compactValue(current.cond ?? "Condition", 120)} → ${current.taken ? "true" : "false"}`
        : current.kind === "call"
          ? `Enter ${compactValue(current.fn ?? "anonymous", 80)}()`
          : current.kind === "return"
            ? `Return ${compactValue(current.value ?? "", 120)}`
            : current.kind === "returnvoid"
              ? "Return"
              : `Execute ${current.kind}`
    : "No captured events";
  return (
    <section className={`trace-viewer density-${density}`} onKeyDown={onKey} aria-label="Execution replay">
      <div className="replay-heading">
        <div>
          <span className="eyebrow">EXECUTION REPLAY</span>
          <h2>See it. Step through it. Understand it.</h2>
        </div>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={learn}
            onChange={(e) => {
              setLearn(e.target.checked);
              if (e.target.checked) setSpeed(1);
            }}
          />
          Learn mode
        </label>
        <span className="chip">
          {events.length.toLocaleString()} captured events{studentTrace.meta.truncated ? " · partial" : ""}
        </span>
        <details className="display-options">
          <summary>Display options</summary>
          <div>
            <label>
              Layout
              <select
                aria-label="Replay layout"
                value={layout}
                onChange={(e) => displayPreference(e.target.value, density)}
              >
                <option value="balanced">Code + visual</option>
                <option value="visual">Visual focus</option>
              </select>
            </label>
            <label>
              Spacing
              <select
                aria-label="Replay spacing"
                value={density}
                onChange={(e) => displayPreference(layout, e.target.value)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <p>Saved on this device. Your code is not saved in display preferences.</p>
          </div>
        </details>
      </div>
      {divergence && (
        <div className="divergence-banner">
          <Icon name="alert" />
          <div>
            <strong>First recorded difference · line {divergence.studentLine ?? "?"}</strong>
            <p>
              {divergence.studentText} · reference: {divergence.referenceText}
            </p>
          </div>
          <button className="btn" onClick={() => seek(divergence.studentSeq)}>
            Inspect difference
          </button>
        </div>
      )}
      <div
        className="panel replay-controls"
        tabIndex={0}
        aria-label="Replay controls. Arrow keys step; space plays; Home and End jump."
      >
        <div className="transport">
          <div className="transport-buttons">
            <button
              className="btn icon-btn"
              aria-label="First step"
              disabled={!events.length || index === 0}
              onClick={() => seek(0)}
            >
              <Icon name="first" />
            </button>
            <button
              className="btn icon-btn"
              aria-label="Previous step"
              disabled={!events.length || index === 0}
              onClick={() => seek(index - 1)}
            >
              <Icon name="back" />
            </button>
            <button
              className="btn btn-primary"
              disabled={!events.length}
              onClick={() => {
                if (!playing && index === last) setIndex(0);
                setPlaying(!playing);
              }}
            >
              <Icon name={playing ? "pause" : "play"} />
              {playing ? "Pause" : "Play"}
            </button>
            <button
              className="btn icon-btn"
              aria-label="Next step"
              disabled={!events.length || index === last}
              onClick={() => seek(index + 1)}
            >
              <Icon name="next" />
            </button>
            <button
              className="btn icon-btn"
              aria-label="Last step"
              disabled={!events.length || index === last}
              onClick={() => seek(last)}
            >
              <Icon name="last" />
            </button>
          </div>
          <span className="step-counter mono">
            {events.length ? index + 1 : 0}
            <span> / {events.length}</span>
          </span>
          <label className="speed-control">
            Speed
            <select
              aria-label="Replay speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn next-value"
            disabled={navigation.next(index, "value") === undefined}
            onClick={() => seek(navigation.next(index, "value") ?? index)}
          >
            Next value <Icon name="next" />
          </button>
        </div>
        <div className="timeline-density" aria-hidden="true">
          {buckets.map((bucket) => (
            <span
              key={bucket.index}
              style={{ background: COLORS[bucket.kind], opacity: bucket.index <= index ? 1 : 0.3 }}
            />
          ))}
          <span className="timeline-cursor" style={{ left: `${last ? (index / last) * 100 : 0}%` }} />
        </div>
        <input
          type="range"
          className="scrubber"
          aria-label="Execution step"
          aria-valuetext={`Step ${events.length ? index + 1 : 0} of ${events.length}, line ${current?.line ?? 0}`}
          min={0}
          max={last}
          value={index}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!events.length}
        />
        <div className="timeline-legend">
          <span>Timeline overview · {buckets.length} groups</span>
          <div>
            {["assign", "branch", "call", "line"].map((kind) => (
              <span key={kind}>
                <i style={{ background: COLORS[kind] }} />
                {kind}
              </span>
            ))}
          </div>
        </div>
        <div className="event-focus">
          <span className="event-kind" style={{ color: COLORS[current?.kind ?? "line"] }}>
            {current?.kind ?? "empty"}
          </span>
          <strong className="mono">{description}</strong>
          <span className="chip">line {current?.line ?? "—"}</span>
        </div>
      </div>
      <div className="replay-mobile-switch" role="group" aria-label="Replay panel">
        <button
          className={`btn ${mobileView === "visual" ? "btn-primary" : ""}`}
          aria-pressed={mobileView === "visual"}
          onClick={() => setMobileView("visual")}
        >
          <Icon name="layers" />
          Visual
        </button>
        <button
          className={`btn ${mobileView === "code" ? "btn-primary" : ""}`}
          aria-pressed={mobileView === "code"}
          onClick={() => setMobileView("code")}
        >
          <Icon name="code" />
          Code
        </button>
      </div>
      <div className={`replay-stage layout-${layout} mobile-${mobileView}`}>
        <div className="replay-code-context">
          <SourceWalkthrough
            source={studentSource}
            line={current?.line ?? 1}
            referenceSource={hasReference && showReference ? referenceSource : undefined}
            referenceLine={refEvents?.[refIndex]?.line}
          />
          {learn && <LearnStep event={current} previous={previous.variables} />}
          {learn && (
            <PredictionCheck
              event={events[navigation.next(index, "value") ?? -1]}
              onReveal={() => seek(navigation.next(index, "value") ?? index)}
            />
          )}
        </div>
        <div className="replay-state-context">
          {current?.kind === "branch" && (
            <div className="panel branch-inspector">
              <span className="eyebrow">RECORDED CONTROL FLOW</span>
              <div className="branch-condition mono">{compactValue(current.cond || "Condition", 180)}</div>
              <div className="branch-paths">
                <div className={current.taken ? "taken" : ""}>
                  <strong>True</strong>
                  <span>{current.taken ? "Recorded outcome" : "Alternative outcome"}</span>
                </div>
                <div className={!current.taken ? "taken false-path" : ""}>
                  <strong>False</strong>
                  <span>{!current.taken ? "Recorded outcome" : "Alternative outcome"}</span>
                </div>
              </div>
              <p className="coverage-note">
                Only the condition outcome is recorded here. The alternate path is a diagram of the decision,
                not an executed trace.
              </p>
            </div>
          )}
          {hasReference && (
            <div className="reference-control">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={showReference}
                  onChange={(e) => setShowReference(e.target.checked)}
                />
                Compare reference state
              </label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={referenceCursor === null}
                  onChange={(e) => setReferenceCursor(e.target.checked ? null : alignedReference)}
                />
                Follow recorded alignment
              </label>
              {referenceCursor !== null && (
                <label className="reference-scrubber">
                  Reference step {refIndex + 1}
                  <input
                    type="range"
                    aria-label="Reference execution step"
                    min={0}
                    max={Math.max(0, (refEvents?.length ?? 1) - 1)}
                    value={refIndex}
                    onChange={(e) => setReferenceCursor(Number(e.target.value))}
                  />
                </label>
              )}
              {referenceCursor === null && divergence && index > divergence.studentSeq && (
                <p className="coverage-note">
                  Alignment ends at the first difference. Unlink the reference to explore its later steps
                  independently.
                </p>
              )}
            </div>
          )}
          <VisualBoundary key={studentTrace.meta.testId}>
            <ExecutionCanvas
              variables={state.variables}
              previous={previous.variables}
              reference={hasReference && showReference ? refState.variables : undefined}
              stack={state.stack}
              histories={stateIndex.histories}
              index={index}
              onSeek={seek}
              activeVariable={events[navigation.latestValue(index) ?? -1]?.name}
            />
          </VisualBoundary>
        </div>
      </div>
      <div className="panel source-replay">
        <button className="disclosure" aria-expanded={showSource} onClick={() => setShowSource(!showSource)}>
          <Icon name="code" />
          <strong>Source at this step</strong>
          <span className="muted">{showSource ? "Hide" : "Show"} source</span>
        </button>
        {showSource && (
          <div className={`source-panels ${hasReference && showReference ? "compare" : ""}`}>
            <div>
              <div className="editor-title">YOUR EXECUTION · line {current?.line ?? "—"}</div>
              <CodeEditor
                value={studentSource}
                language={language}
                currentLine={current?.line}
                markerLine={divergence?.studentLine}
                height="300px"
              />
            </div>
            {hasReference && showReference && (
              <div>
                <div className="editor-title">REFERENCE · line {refEvents?.[refIndex]?.line ?? "—"}</div>
                <CodeEditor
                  value={referenceSource}
                  language={language}
                  currentLine={refEvents?.[refIndex]?.line}
                  height="300px"
                />
              </div>
            )}
          </div>
        )}
      </div>
      <details className="panel event-log" onToggle={(event) => setShowLog(event.currentTarget.open)}>
        <summary>Event log · search the captured execution</summary>
        {showLog && (
          <>
            <div className="event-search">
              <label>
                Search
                <input
                  type="search"
                  aria-label="Search events by variable, value or line"
                  placeholder="Variable, value, line…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label>
                Type
                <select
                  aria-label="Event type"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All events</option>
                  {Object.keys(COLORS).map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="event-rows">
              {rows.slice(rowPage * 30, rowPage * 30 + 30).map(({ event, i }) => (
                <button
                  key={i}
                  className={`event-row ${i === index ? "selected" : ""}`}
                  onClick={() => seek(i)}
                  aria-label={`Step ${i + 1}, ${event.kind}, line ${event.line}`}
                >
                  <span className="mono">{i + 1}</span>
                  <span style={{ color: COLORS[event.kind] }}>{event.kind}</span>
                  <span className="mono">
                    {event.name ? `${event.name} = ${event.value}` : (event.cond ?? event.fn ?? "statement")}
                  </span>
                  <span>line {event.line}</span>
                </button>
              ))}
            </div>
            {!rows.length && <p className="muted">No matching events.</p>}
            <div className="pagination">
              <button className="btn" disabled={rowPage === 0} onClick={() => setPage(rowPage - 1)}>
                Previous
              </button>
              <span>
                {rows.length} events · page {rowPage + 1} of {Math.max(1, Math.ceil(rows.length / 30))}
              </span>
              <button
                className="btn"
                disabled={(rowPage + 1) * 30 >= rows.length}
                onClick={() => setPage(rowPage + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </details>
      {output !== undefined && output !== null && (
        <div className="panel output-console">
          <div className="section-heading">
            <h3>Program output</h3>
            <span className="chip">stdout</span>
          </div>
          <pre className="mono">{output || "(no output)"}</pre>
        </div>
      )}
      <p className="coverage-note">
        Replay shows supported recorded events. Uncaptured operations and truncated state are not
        reconstructed.
      </p>
    </section>
  );
}
