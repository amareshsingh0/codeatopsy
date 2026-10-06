"use client";
import type { AutopsyReport } from "@codeautopsy/schemas";

export function Report({ report }: { report: AutopsyReport }) {
  const d = report.divergence;
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)", background: "var(--panel-2)" }}>
        <h2 className="text-[15px] font-bold">🩺 Autopsy Report</h2>
        <span className="chip">{report.provider === "rules" ? "rule engine" : report.provider}</span>
      </div>

      <div className="grid gap-4 p-4">
        <p className="text-[14px] font-semibold leading-relaxed">{report.headline}</p>

        {d && (
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--danger)", background: "color-mix(in srgb, var(--danger) 7%, transparent)" }}>
            <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--danger)" }}>
              First divergence · test {d.testId}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="mono rounded-lg px-3 py-2 text-xs" style={{ background: "var(--panel)" }}>
                <div style={{ color: "var(--danger)" }}>you · line {d.studentLine ?? "?"}</div>
                <div className="mt-1">{d.studentText}</div>
              </div>
              <div className="mono rounded-lg px-3 py-2 text-xs" style={{ background: "var(--panel)" }}>
                <div style={{ color: "var(--accent-2)" }}>reference · line {d.referenceLine ?? "?"}</div>
                <div className="mt-1">{d.referenceText}</div>
              </div>
            </div>
          </div>
        )}

        {report.hypotheses.length > 0 && (
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              Root-cause hypotheses (ranked)
            </h3>
            <div className="mt-2 grid gap-2">
              {report.hypotheses.map((h, i) => (
                <div key={h.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-bold">
                      {i + 1}. {h.title}
                    </span>
                    <ConfidenceBar value={h.confidence} />
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                    {h.mechanism}
                  </p>
                  {h.lines.length > 0 && (
                    <div className="mt-2 flex gap-1.5">
                      {h.lines.map((l) => (
                        <span key={l} className="chip mono text-[10px]">line {l}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {report.narrative && (
          <details>
            <summary className="cursor-pointer text-[13px] font-bold" style={{ color: "var(--muted)" }}>
              Full narrative
            </summary>
            <pre className="scroll-thin mono mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl p-3 text-xs leading-relaxed" style={{ background: "var(--panel-2)" }}>
              {report.narrative}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.75 ? "var(--danger)" : value >= 0.5 ? "var(--warn)" : "var(--muted)";
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="mono text-[10px]" style={{ color }}>{pct}%</span>
    </span>
  );
}
