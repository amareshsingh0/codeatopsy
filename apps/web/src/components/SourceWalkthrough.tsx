"use client";
import { useMemo } from "react";
import { compactValue, sourceWindow } from "@/lib/replay-insights";
import { Icon } from "./Icon";

export function SourceWalkthrough({
  source,
  line,
  referenceSource,
  referenceLine,
}: {
  source: string;
  line: number;
  referenceSource?: string;
  referenceLine?: number;
}) {
  const lines = useMemo(() => source.split(/\r?\n/), [source]);
  const reference = useMemo(() => referenceSource?.split(/\r?\n/), [referenceSource]);
  return (
    <aside className="source-context panel" aria-label="Source synchronized with the replay">
      <div className="source-context-heading">
        <Icon name="code" />
        <strong>Follow the code</strong>
        <span className="chip">Line {line}</span>
      </div>
      <p>Source line linked to the selected event.</p>
      <ol className="source-window mono" aria-label="Your source around the current line">
        {sourceWindow(lines, line).map((row) => (
          <li
            key={row.line}
            className={row.active ? "active" : ""}
            aria-current={row.active ? "step" : undefined}
          >
            <span aria-hidden="true">{row.line}</span>
            <code>{compactValue(row.text || " ", 500)}</code>
          </li>
        ))}
      </ol>
      {reference && (
        <details className="reference-context">
          <summary>Reference · line {referenceLine ?? 1}</summary>
          <ol className="source-window mono">
            {sourceWindow(reference, referenceLine ?? 1, 7).map((row) => (
              <li key={row.line} className={row.active ? "active" : ""}>
                <span>{row.line}</span>
                <code>{row.text || " "}</code>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="source-context-note">
        <span className="source-line-key" /> Current line <span>Read it, then step forward.</span>
      </div>
    </aside>
  );
}
