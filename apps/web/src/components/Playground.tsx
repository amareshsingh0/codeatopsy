"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Submission } from "@codeautopsy/schemas";
import { alignTraces } from "@codeautopsy/trace-core";
import { TraceViewer } from "./TraceViewer";
import { Report } from "./Report";

const ClientCodeEditor = dynamic(() => import("./CodeEditor").then((m) => m.CodeEditor), { ssr: false });

const STARTER = `#include <bits/stdc++.h>
using namespace std;

// Write ANY code — paste your own solution, experiment freely.
// Every assignment, branch and call is recorded.
int main() {
    int n;
    cin >> n;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];

    int best = 0, sum = 0;
    for (int i = 0; i < n; i++) {
        sum = max(sum + a[i], a[i]);   // Kadane's
        best = max(best, sum);
    }
    cout << best << "\\n";
    return 0;
}
`;

type Phase = "editing" | "running" | "done" | "error";

export function Playground() {
  const [source, setSource] = useState(STARTER);
  const [input, setInput] = useState("9\n-2 1 -3 4 -1 2 1 -5 4\n");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [phase, setPhase] = useState<Phase>("editing");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const submit = useCallback(async () => {
    setPhase("running");
    setError(null);
    setSubmission(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId: "playground", source, input, expectedOutput }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? `submit failed (${res.status})`);
      poll(body.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [source, input, expectedOutput]);

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/submissions/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`poll failed (${res.status})`);
        const sub = (await res.json()) as Submission;
        setSubmission(sub);
        if (sub.status === "completed" || sub.status === "failed") {
          setPhase("done");
          return;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
        return;
      }
      pollTimer.current = setTimeout(tick, 1200);
    };
    pollTimer.current = setTimeout(tick, 800);
  }, []);

  const result = submission?.result ?? null;
  const verdict = result?.verdicts[0] ?? null;

  const viewerData = useMemo(() => {
    if (!result) return null;
    const st = result.studentTraces["run-1"];
    if (!st) return null;
    return { trace: st, output: verdict?.output ?? null };
  }, [result, verdict]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Playground 🔬</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>
            Paste any C++ program and your own stdin — every assignment, branch and call is traced.
          </p>
        </div>
        <Link href="/" className="btn">← Problem library</Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* left: code */}
        <div className="grid content-start gap-4">
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="mono text-xs" style={{ color: "var(--muted)" }}>main.cpp</span>
              <button className="btn btn-primary" onClick={submit} disabled={phase === "running"}>
                {phase === "running" ? "Running…" : "▶ Trace it"}
              </button>
            </div>
            <ClientCodeEditor value={source} height="380px" readOnly={false} />
          </div>

          {phase === "running" && (
            <div className="panel p-4 text-[13px]">
              <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
              {submission?.status ?? "queued"}…
            </div>
          )}
          {error && (
            <div className="panel p-4 text-[13px]" style={{ borderColor: "var(--danger)" }}>⚠ {error}</div>
          )}

          {viewerData && (
            <TraceViewer
              studentSource={source}
              referenceSource=""
              studentTrace={viewerData.trace}
              output={viewerData.output}
            />
          )}
        </div>

        {/* right: io + report */}
        <div className="grid content-start gap-4">
          <div className="panel p-4">
            <label className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              stdin
            </label>
            <textarea
              className="mono scroll-thin mt-2 h-36 w-full resize-y rounded-lg border p-2.5 text-xs"
              style={{ background: "var(--panel-2)", borderColor: "var(--border)", color: "var(--text)" }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              placeholder="input for your program…"
            />
          </div>
          <div className="panel p-4">
            <label className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              expected output <span className="normal-case" style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              className="mono scroll-thin mt-2 h-24 w-full resize-y rounded-lg border p-2.5 text-xs"
              style={{ background: "var(--panel-2)", borderColor: "var(--border)", color: "var(--text)" }}
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              spellCheck={false}
              placeholder="leave empty to just run and trace"
            />
            {verdict && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span
                  className="chip"
                  style={{
                    color: verdict.status === "accepted" ? "var(--accent-2)" : "var(--danger)",
                    borderColor: verdict.status === "accepted" ? "var(--accent-2)" : "var(--danger)",
                  }}
                >
                  {verdict.status === "accepted"
                    ? "✓ ran cleanly"
                    : verdict.status === "wrong_answer"
                      ? "✗ output mismatch"
                      : verdict.status === "timeout"
                        ? "⏱ time limit"
                        : "💥 runtime error"}
                </span>
                {verdict.detail && (
                  <span className="mono text-[11px]" style={{ color: "var(--muted)" }}>{verdict.detail}</span>
                )}
              </div>
            )}
          </div>

          {result?.report && <Report report={result.report} />}
        </div>
      </div>
    </div>
  );
}
