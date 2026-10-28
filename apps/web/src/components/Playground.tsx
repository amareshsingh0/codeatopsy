"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGE_LABEL, type Language } from "@codeautopsy/schemas";
import { WorkspaceViews, type WorkspaceView } from "./WorkspaceViews";
import { Report } from "./Report";
import { useSubmission } from "./useSubmission";
import { ExecutionDetails } from "./ExecutionDetails";
import { RunProgress } from "./RunProgress";
import { Icon } from "./Icon";
import { getDiagnostics } from "@/lib/diagnostics";
import { SystemStatus } from "./SystemStatus";
import type { LearningExample } from "@/lib/examples";

const ClientCodeEditor = dynamic(() => import("./CodeEditor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => (
    <div className="editor-loading" style={{ height: 380 }} role="status">
      Preparing your editor…
    </div>
  ),
});
const TraceViewer = dynamic(() => import("./TraceViewer").then((m) => m.TraceViewer), {
  loading: () => (
    <p className="panel p-5" role="status">
      Preparing the replay…
    </p>
  ),
});

const STARTERS: Record<Language, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

// Maximum subarray example. Try an all-negative input to investigate it.
int main() {
    int n;
    cin >> n;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];

    int best = 0, sum = 0;
    for (int i = 0; i < n; i++) {
        sum = max(sum + a[i], a[i]);
        best = max(best, sum);
    }
    cout << best << endl;
    return 0;
}
`,
  c: `#include <stdio.h>

// C execution example. Trace coverage depends on supported instrumentation.
int main() {
    int n;
    if (scanf("%d", &n) != 1) return 0;
    int best = 0, sum = 0;
    for (int i = 0; i < n; i++) {
        int x;
        scanf("%d", &x);
        if (sum + x > x) sum = sum + x;
        else sum = x;
        if (sum > best) best = sum;
    }
    printf("%d\\n", best);
    return 0;
}
`,
  python: `# Python execution example with recorded variable snapshots.
n = int(input())
a = [int(x) for x in input().split()]

best = 0
cur = 0
for x in a:
    cur = max(cur + x, x)
    best = max(best, cur)
print(best)
`,
  javascript: `// JavaScript execution example using Node.js standard input.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const lines = input.split(String.fromCharCode(10)).filter((l) => l.length);
  const n = parseInt(lines[0]);
  const a = lines[1].split(" ").map(Number);

  let best = 0;
  let cur = 0;
  for (let i = 0; i < n; i++) {
    cur = Math.max(cur + a[i], a[i]);
    best = Math.max(best, cur);
  }
  console.log(best);
});
`,
  java: `import java.util.*;

// Java execution example. The public class must be named Main.
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int best = 0, cur = 0;
        for (int i = 0; i < n; i++) {
            int x = sc.nextInt();
            cur = Math.max(cur + x, x);
            best = Math.max(best, cur);
        }
        System.out.println(best);
    }
}
`,
};

const DEFAULT_INPUTS: Record<Language, string> = {
  cpp: `9
-2 1 -3 4 -1 2 1 -5 4`,
  c: `9
-2 1 -3 4 -1 2 1 -5 4`,
  python: `9
-2 1 -3 4 -1 2 1 -5 4`,
  javascript: `9
-2 1 -3 4 -1 2 1 -5 4`,
  java: `9
-2 1 -3 4 -1 2 1 -5 4`,
};

const LANGUAGES: Language[] = ["cpp", "c", "python", "javascript", "java"];

export function Playground({ example }: { example?: LearningExample }) {
  const [language, setLanguage] = useState<Language>(example?.language ?? "cpp");
  const [source, setSource] = useState(example?.source ?? STARTERS.cpp);
  const [input, setInput] = useState(example ? "" : DEFAULT_INPUTS.cpp);
  const [expectedOutput, setExpectedOutput] = useState(example?.expectedOutput ?? "");
  const { phase, submission, error, submit: runSubmission, reset, stop } = useSubmission();
  const [diagnosticLine, setDiagnosticLine] = useState<number | null>(null);
  const [view, setView] = useState<WorkspaceView>("edit");
  const views = useRef<HTMLDivElement>(null);
  const revealReplay = useCallback(
    () => views.current?.scrollIntoView({ block: "start", behavior: "instant" }),
    [],
  );
  const switchLanguage = (lang: Language) => {
    reset();
    setLanguage(lang);
    setSource(STARTERS[lang]);
    setInput(DEFAULT_INPUTS[lang]);
    setExpectedOutput("");
    setDiagnosticLine(null);
    setView("edit");
  };
  const submit = () => {
    setView("edit");
    setDiagnosticLine(null);
    void runSubmission({ problemId: "playground", source, input, expectedOutput, language });
  };

  const result = submission?.result ?? null;
  const verdict = result?.verdicts[0] ?? null;

  const viewerData = useMemo(() => {
    if (!result) return null;
    const st = result.studentTraces["run-1"];
    if (!st) return null;
    return { trace: st, output: verdict?.output ?? null };
  }, [result, verdict]);
  useEffect(() => {
    if (result) {
      setView(viewerData ? "replay" : "evidence");
      const frame = requestAnimationFrame(() =>
        views.current?.scrollIntoView({ block: "start", behavior: "instant" }),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [result, viewerData]);
  const inspectLine = (line: number) => {
    setDiagnosticLine(line);
    setView("edit");
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="workspace-heading">
          <span className="eyebrow">YOUR EXECUTION LAB</span>
          <h1>From source to understanding.</h1>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>
            Run C++, C, Python, JavaScript or Java with your own input. Tracing is available for C++, Python,
            JavaScript and compatible C programs; Java currently returns output and verdicts.
          </p>
          <SystemStatus />
          {example && (
            <div className="example-question">
              <span className="eyebrow">{example.title}</span>
              <p>{example.question}</p>
              <Link href="/atlas">Choose another concept →</Link>
            </div>
          )}
        </div>
        <Link href="/" className="btn">
          ← Problem library
        </Link>
      </div>

      <div ref={views} className="workspace-view-anchor">
        <WorkspaceViews
          view={view}
          onChange={setView}
          replayReady={!!viewerData}
          resultReady={!!result}
          running={phase === "running"}
        />
      </div>
      <div className="workspace-panel grid gap-5 lg:grid-cols-[1fr_320px]" hidden={view !== "edit"}>
        {/* left: code */}
        <div className="grid content-start gap-4">
          <div className="panel overflow-hidden">
            <div
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2">
                <select
                  className="mono rounded-md border bg-transparent px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  value={language}
                  onChange={(e) => switchLanguage(e.target.value as Language)}
                  aria-label="Language"
                  disabled={phase === "running"}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </select>
                <span className="mono text-xs" style={{ color: "var(--muted)" }}>
                  {language === "cpp"
                    ? "main.cpp"
                    : language === "c"
                      ? "main.c"
                      : language === "python"
                        ? "main.py"
                        : language === "java"
                          ? "Main.java"
                          : "main.js"}
                </span>
              </div>
              <button className="btn btn-primary" onClick={submit} disabled={phase === "running"}>
                <Icon name="play" />
                {phase === "running" ? "Running…" : "Run & inspect"}
              </button>
            </div>
            <ClientCodeEditor
              key={language}
              value={source}
              onChange={setSource}
              language={language}
              height="380px"
              readOnly={phase === "running"}
              markerLine={
                source === submission?.source
                  ? (diagnosticLine ?? (result ? getDiagnostics(result).find((d) => d.line)?.line : null))
                  : null
              }
              currentLine={source === submission?.source ? diagnosticLine : null}
            />
            <div className="editor-note">
              Original source determines the verdict. Replay uses a separate instrumented run; unsupported
              trace operations are reported.
            </div>
          </div>

          {phase === "running" && <RunProgress status={submission?.status} onStop={stop} />}
          {error && (
            <div className="panel diagnostic" role="alert">
              <strong>Run could not complete</strong>
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* right: io + report */}
        <div className="grid content-start gap-4">
          <div className="panel p-4">
            <label
              htmlFor="program-input"
              className="text-[13px] font-bold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              stdin
            </label>
            <textarea
              id="program-input"
              disabled={phase === "running"}
              className="mono scroll-thin mt-2 h-36 w-full resize-y rounded-lg border p-2.5 text-xs"
              style={{ background: "var(--panel-2)", borderColor: "var(--border)", color: "var(--text)" }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              placeholder="input for your program…"
            />
          </div>
          <div className="panel p-4">
            <label
              htmlFor="expected-output"
              className="text-[13px] font-bold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              expected output{" "}
              <span className="normal-case" style={{ fontWeight: 400 }}>
                (optional)
              </span>
            </label>
            <textarea
              id="expected-output"
              disabled={phase === "running"}
              className="mono scroll-thin mt-2 h-24 w-full resize-y rounded-lg border p-2.5 text-xs"
              style={{ background: "var(--panel-2)", borderColor: "var(--border)", color: "var(--text)" }}
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              spellCheck={false}
              placeholder="leave empty to just run and trace"
            />
            {verdict && (
              <div className="mt-2 grid gap-1 text-xs">
                <div className="flex items-center gap-2">
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
                  <span className="mono text-[11px]" style={{ color: "var(--muted)" }}>
                    {verdict.durationMs} ms
                  </span>
                </div>
                {verdict.detail && (
                  <span className="mono text-[11px]" style={{ color: "var(--muted)" }}>
                    {verdict.detail}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {viewerData && (
        <div className="workspace-panel" hidden={view !== "replay"}>
          <TraceViewer
            active={view === "replay"}
            onReady={revealReplay}
            studentSource={submission?.source ?? source}
            language={result?.language ?? language}
            studentTrace={viewerData.trace}
            output={viewerData.output}
          />
        </div>
      )}
      {result && (
        <div className="workspace-panel evidence-layout" hidden={view !== "evidence"}>
          <ExecutionDetails result={result} showOutput onInspectLine={inspectLine} />
          {result.report && <Report report={result.report} />}
        </div>
      )}
    </div>
  );
}
