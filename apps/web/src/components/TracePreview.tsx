"use client";
import { useState } from "react";
import { Icon } from "./Icon";
// A labelled, deterministic illustration. Production replay always uses runtime events.
const VALUES = [2, 4, 7, 11, 16, 21, 29];
const STEPS = [
  { lo: 0, hi: 6, mid: 3 },
  { lo: 4, hi: 6, mid: 5 },
  { lo: 4, hi: 4, mid: 4 },
];
export function TracePreview() {
  const [step, setStep] = useState(0);
  const state = STEPS[step];
  return (
    <div className="preview-lab">
      <div className="section-heading">
        <span className="eyebrow">INTERACTIVE EXAMPLE</span>
        <span className="chip">Binary search · target 16</span>
      </div>
      <div className="preview-cells">
        {VALUES.map((value, i) => (
          <div
            className={`preview-cell ${i === state.mid ? "active" : ""} ${i < state.lo || i > state.hi ? "excluded" : ""}`}
            key={i}
          >
            <span className="mono">{i}</span>
            <strong className="mono">{value}</strong>
            <span>{i === state.mid ? "mid" : i === state.lo ? "lo" : i === state.hi ? "hi" : ""}</span>
          </div>
        ))}
      </div>
      <div className="preview-bottom">
        <p>
          {step === 2
            ? "16 found. The search interval is one cell."
            : `${VALUES[state.mid]} ${VALUES[state.mid] < 16 ? "<" : ">"} 16. Narrow the interval.`}
        </p>
        <button className="btn" onClick={() => setStep((step + 1) % STEPS.length)}>
          {step === 2 ? "Replay example" : "Next step"}
          <Icon name="arrow" />
        </button>
      </div>
      <p className="coverage-note">Illustrative example. Run your code to inspect its actual execution.</p>
    </div>
  );
}
