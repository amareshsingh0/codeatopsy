import type { ExecutionResult } from "@codeautopsy/schemas";
import { getDiagnostics } from "@/lib/diagnostics";
import { Icon } from "./Icon";

export function ExecutionDetails({
  result,
  showOutput,
  onInspectLine,
}: {
  result: ExecutionResult;
  showOutput: boolean;
  onInspectLine?: (line: number) => void;
}) {
  const diagnostics = getDiagnostics(result);
  const passed = result.verdicts.filter((verdict) => verdict.status === "accepted").length;
  return (
    <div className="grid gap-3">
      {result.verdicts.length > 0 && (
        <div className="panel p-4">
          <div className="section-heading">
            <h2 className="text-sm font-semibold">Run evidence</h2>
            <span className={`chip ${passed === result.verdicts.length ? "chip-accepted" : "chip-wrong"}`}>
              {passed} / {result.verdicts.length} tests passed
            </span>
          </div>
          <p className="coverage-note">
            {result.verdicts.reduce((sum, verdict) => sum + verdict.durationMs, 0)} ms total original
            execution · {Object.keys(result.studentTraces).length} captured traces
          </p>
        </div>
      )}
      {diagnostics.map((diagnostic, i) => (
        <div
          key={i}
          className={`panel diagnostic ${diagnostic.severity === "warning" ? "warning" : ""}`}
          role={diagnostic.severity === "error" ? "alert" : undefined}
        >
          <h3>
            <Icon name="alert" />
            {diagnostic.title}
            {diagnostic.testId && <span className="chip">{diagnostic.testId}</span>}
          </h3>
          <p>{diagnostic.message}</p>
          {diagnostic.line && onInspectLine && (
            <button className="btn" onClick={() => onInspectLine(diagnostic.line!)}>
              Inspect line {diagnostic.line}
              {diagnostic.column ? `:${diagnostic.column}` : ""}
            </button>
          )}
          {diagnostic.detail && (
            <details>
              <summary>Full diagnostic</summary>
              <pre className="mono">{diagnostic.detail}</pre>
            </details>
          )}
        </div>
      ))}
      {showOutput &&
        result.verdicts.map((verdict) => (
          <div key={verdict.testId} className="panel p-4">
            <h2 className="text-sm font-bold">Output — {verdict.testId}</h2>
            <p className="mt-1 text-xs">
              {verdict.status} · {verdict.durationMs} ms{verdict.detail ? ` · ${verdict.detail}` : ""}
            </p>
            <pre className="mono mt-2 overflow-auto whitespace-pre-wrap text-xs">
              {verdict.output || "(no output)"}
            </pre>
          </div>
        ))}
    </div>
  );
}
