"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGE_LABEL, type Language, type Submission } from "@codeautopsy/schemas";
import { alignTraces } from "@codeautopsy/trace-core";
import { TraceViewer } from "./TraceViewer";
import { Report } from "./Report";

const ClientCodeEditor = dynamic(() => import("./CodeEditor").then((m) => m.CodeEditor), { ssr: false });


const STARTERS: Record<Language, string> = {  cpp: `#include <bits/stdc++.h>
using namespace std;

// Koi bhi C++ code — har assignment, branch aur call record hoti hai.
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

// Koi bhi C code
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
  python: `# Koi bhi Python code — sys.settrace se har step record hota hai.
n = int(input())
a = [int(x) for x in input().split()]

best = 0
cur = 0
for x in a:
    cur = max(cur + x, x)
    best = max(best, cur)
print(best)
`,
  javascript: `// Koi bhi JavaScript (Node) code
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

// Koi bhi Java code (public class ka naam Main rakho)
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

type Phase = "editing" | "running" | "done" | "error";

export function Playground() {
  const [language, setLanguage] = useState<Language>("cpp");
  const [source, setSource] = useState(STARTERS.cpp);
  const [input, setInput] = useState(DEFAULT_INPUTS.cpp);
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

  const switchLanguage = (lang: Language) => {
    setLanguage(lang);
    setSource(STARTERS[lang]);
    setInput(DEFAULT_INPUTS[lang]);
    setSubmission(null);
    setError(null);
    setPhase("editing");
  };

  const submit = useCallback(async () => {
    setPhase("running");
    setError(null);
    setSubmission(null);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId: "playground", source, input, expectedOutput, language }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? `submit failed (${res.status})`);
      poll(body.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [source, input, expectedOutput, language]);

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
            C++, C, Python, JavaScript ya Java — apna code + stdin do, har step trace hota hai.
          </p>
        </div>
        <Link href="/" className="btn">← Problem library</Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* left: code */}
        <div className="grid content-start gap-4">
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2">
                <select
                  className="mono rounded-md border bg-transparent px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  value={language}
                  onChange={(e) => switchLanguage(e.target.value as Language)}
                  aria-label="Language"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>{LANGUAGE_LABEL[l]}</option>
                  ))}
                </select>
                <span className="mono text-xs" style={{ color: "var(--muted)" }}>
                  {language === "cpp" || language === "c" ? "main.cpp" : language === "python" ? "main.py" : language === "java" ? "Main.java" : "main.js"}
                </span>
              </div>
              <button className="btn btn-primary" onClick={submit} disabled={phase === "running"}>
                {phase === "running" ? "Running…" : "▶ Trace it"}
              </button>
            </div>
            <ClientCodeEditor
              key={language}
              value={source}
              onChange={setSource}
              language={language}
              height="380px"
              readOnly={false}
            />
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
                  <span className="mono text-[11px]" style={{ color: "var(--muted)" }}>{verdict.durationMs} ms</span>
                </div>
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

