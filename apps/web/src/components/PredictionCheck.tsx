"use client";
import { useEffect, useState } from "react";
import type { TraceEvent } from "@codeautopsy/schemas";
import { parseValueView } from "@/lib/trace-state";
import { compactValue } from "@/lib/replay-insights";
export function PredictionCheck({ event, onReveal }: { event?: TraceEvent; onReveal: () => void }) {
  const [guess, setGuess] = useState("");
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    setGuess("");
    setFeedback("");
  }, [event]);
  if (
    !event?.value ||
    event.value.length > 100 ||
    !["scalar", "string"].includes(parseValueView(event.value).kind) ||
    event.value.startsWith("<")
  )
    return null;
  const normalize = (value: string) => {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value.trim();
    }
  };
  const expected = parseValueView(event.value);
  const check = () =>
    setFeedback(
      normalize(guess) === normalize(event.value!) || (expected.kind === "string" && guess === expected.text)
        ? "That matches the recorded value. Step forward to see it."
        : "That does not match the recorded value. Check the highlighted source, or reveal the next step.",
    );
  return (
    <details className="prediction-check panel">
      <summary>
        Pause & predict <span>Optional practice</span>
      </summary>
      <div>
        <p>
          At the next captured update on line {event.line}, what will{" "}
          <code>{compactValue(event.name ?? "the variable", 60)}</code> hold?
        </p>
        <label>
          Your prediction
          <input
            value={guess}
            maxLength={200}
            onChange={(e) => {
              setGuess(e.target.value);
              setFeedback("");
            }}
            placeholder="Try a value…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && guess.trim()) check();
            }}
          />
        </label>
        <div className="prediction-actions">
          <button className="btn" disabled={!guess.trim()} onClick={check}>
            Check prediction
          </button>
          <button className="btn" onClick={onReveal}>
            Reveal & step
          </button>
        </div>
        {feedback && <p role="status">{feedback}</p>}
        <p className="coverage-note">Checked against this run's captured value, not an AI guess.</p>
      </div>
    </details>
  );
}
