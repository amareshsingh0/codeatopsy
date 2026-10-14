"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Problem, Submission, TestVerdict } from "@codeautopsy/schemas";
import { alignTraces } from "@codeautopsy/trace-core";
import { TraceViewer } from "./TraceViewer";
import { Report } from "./Report";
import { useSubmission } from "./useSubmission";
import { ExecutionDetails } from "./ExecutionDetails";
import { RunProgress } from "./RunProgress";
import { Icon } from "./Icon";
import { getDiagnostics } from "@/lib/diagnostics";

const ClientCodeEditor = dynamic(() => import("./CodeEditor").then((m) => m.CodeEditor), { ssr: false });

export type ClientProblem = Omit<Problem, "referenceSource">;

export function Workspace({ problem }: { problem: ClientProblem }) {
  const [source, setSource] = useState(problem.studentSource);
  const { phase, submission, error, submit: runSubmission, stop } = useSubmission();
  const [diagnosticLine, setDiagnosticLine] = useState<number | null>(null);
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const submit = () => {
    setSelectedTest(null);
    setDiagnosticLine(null);
    void runSubmission({ problemId: problem.slug, source });
  };

  const result = submission?.result ?? null;
  const verdicts: TestVerdict[] = result?.verdicts ?? [];

  // default test selection: first failing test that has traces, else first traced
  useEffect(() => {
    if (!result || selectedTest) return;
    const firstFailing = result.verdicts.find(
      (v) => v.status !== "accepted" && result.studentTraces[v.testId],
    );
    const firstTraced = result.verdicts.find((v) => result.studentTraces[v.testId]);
    setSelectedTest(firstFailing?.testId ?? firstTraced?.testId ?? result.verdicts[0]?.testId ?? null);
  }, [result, selectedTest]);

  const viewerData = useMemo(() => {
    if (!result || !selectedTest) return null;
    const st = result.studentTraces[selectedTest];
    if (!st) return null;
    const rt = result.referenceTraces[selectedTest] ?? null;
    const hasRef = !!(rt && rt.events.length > 0 && result.referenceSource);
    const aligned = hasRef && rt ? alignTraces(st, rt, selectedTest) : null;
    return {
      studentTrace: st,
      referenceTrace: hasRef ? rt : null,
      referenceSource: result.referenceSource ?? "",
      pairs: aligned?.pairs ?? [],
      divergence: aligned?.divergence ?? null,
      output: result.verdicts.find((v) => v.testId === selectedTest)?.output ?? null,
    };
  }, [result, selectedTest]);

  return (
    <div className="grid gap-5">
      <div className="workspace-heading">
        <span className="eyebrow">PROBLEM INVESTIGATION</span>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">{problem.title}</h1>
          <span className="chip">{problem.difficulty}</span>
          {problem.topics.map((t) => (
            <span key={t} className="chip text-[10px]">
              {t}
            </span>
          ))}
        </div>
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
          {problem.blurb}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* ---------- left: statement + tests ---------- */}
        <div className="grid content-start gap-4">
          <div className="panel p-4">
            <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Statement
            </h2>
            <Markdownish text={problem.statement} />
          </div>

          <div className="panel p-4">
            <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Tests
            </h2>
            <div className="mt-2 grid gap-1.5">
              {problem.tests.map((t) => {
                const v = verdicts.find((x) => x.testId === t.id);
                const status = v?.status ?? null;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTest(t.id)}
                    aria-pressed={selectedTest === t.id}
                    className="test-button flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-[13px] transition"
                    style={{
                      background: selectedTest === t.id ? "var(--panel-2)" : "transparent",
                      border: `1px solid ${selectedTest === t.id ? "var(--border)" : "transparent"}`,
                    }}
                  >
                    <span className="mono">{t.hidden ? `${t.id} (hidden)` : t.id}</span>
                    {status ? (
                      <VerdictChip status={status} />
                    ) : (
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        —
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {phase === "running" && <RunProgress status={submission?.status} onStop={stop} />}
          {error && (
            <div role="alert" className="panel diagnostic">
              ⚠ {error}
            </div>
          )}
        </div>

        {/* ---------- right: editor + viewer ---------- */}
        <div className="grid content-start gap-4">
          <div className="panel overflow-hidden">
            <div
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <span className="mono text-xs" style={{ color: "var(--muted)" }}>
                submission.cpp
              </span>
              <div className="flex gap-2">
                <button
                  className="btn"
                  onClick={() => setSource(problem.studentSource)}
                  disabled={phase === "running"}
                >
                  ↺ Demo code
                </button>
                <button className="btn btn-primary" onClick={submit} disabled={phase === "running"}>
                  <Icon name="play" />
                  {phase === "running" ? "Running…" : "Run autopsy"}
                </button>
              </div>
            </div>
            <ClientCodeEditor
              value={source}
              onChange={setSource}
              language={problem.language}
              currentLine={source === submission?.source ? diagnosticLine : null}
              markerLine={
                source === submission?.source
                  ? (diagnosticLine ??
                    (result ? getDiagnostics(result).find((d) => d.line)?.line : null) ??
                    viewerData?.divergence?.studentLine ??
                    null)
                  : null
              }
              markerClass="cm-divergence-line"
              height="260px"
              readOnly={phase === "running"}
            />
            <div className="editor-note">
              Change the source, run the tests, then inspect the first captured difference.
            </div>
          </div>

          {viewerData && (
            <TraceViewer
              studentSource={submission?.source ?? source}
              referenceSource={viewerData.referenceSource}
              language={problem.language}
              studentTrace={viewerData.studentTrace}
              referenceTrace={viewerData.referenceTrace}
              pairs={viewerData.pairs}
              divergence={viewerData.divergence}
              output={viewerData.output}
            />
          )}

          {result && (
            <ExecutionDetails result={result} showOutput={!viewerData} onInspectLine={setDiagnosticLine} />
          )}
          {result?.report && <Report report={result.report} />}
        </div>
      </div>
    </div>
  );
}

function StatusDisplay({ submission }: { submission: Submission | null }) {
  const status = submission?.status ?? "queued";
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full"
        style={{ background: "var(--accent)" }}
      />
      {status === "queued" && "Queued — waiting for an execution node…"}
      {status === "compiling" && "Compiling…"}
      {status === "running" && "Running tests + collecting traces…"}
      {status === "analyzing" && "Aligning traces, writing the report…"}
      {["completed", "failed"].includes(status) && "Finished."}
    </div>
  );
}

function VerdictChip({ status }: { status: TestVerdict["status"] }) {
  const cls =
    status === "accepted"
      ? "chip chip-accepted"
      : status === "wrong_answer"
        ? "chip chip-wrong"
        : status === "timeout"
          ? "chip chip-timeout"
          : "chip chip-wrong";
  const label =
    status === "accepted"
      ? "✓ pass"
      : status === "wrong_answer"
        ? "✗ wrong"
        : status === "timeout"
          ? "⏱ TLE"
          : status === "runtime_error"
            ? "💥 RTE"
            : "🔧 compile";
  return <span className={cls}>{label}</span>;
}

/** minimal markdown: paragraphs, ``` blocks, inline `code` and **bold** */
function Markdownish({ text }: { text: string }) {
  const parts = text.split(/```[a-z]*\n?/);
  return (
    <div className="mt-2 grid gap-2 text-[13px] leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre
            key={i}
            className="mono scroll-thin overflow-x-auto rounded-lg p-2.5 text-xs"
            style={{ background: "var(--panel-2)" }}
          >
            {part.trimEnd()}
          </pre>
        ) : (
          <p key={i} className="whitespace-pre-wrap" style={{ color: "var(--muted)" }}>
            {inlineMd(part)}
          </p>
        ),
      )}
    </div>
  );
}

function inlineMd(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((chunk, i) => {
    if (chunk.startsWith("**"))
      return (
        <b key={i} style={{ color: "var(--text)" }}>
          {chunk.slice(2, -2)}
        </b>
      );
    if (chunk.startsWith("`"))
      return (
        <code key={i} className="mono rounded px-1 text-xs" style={{ background: "var(--panel-2)" }}>
          {chunk.slice(1, -1)}
        </code>
      );
    return <span key={i}>{chunk}</span>;
  });
}
