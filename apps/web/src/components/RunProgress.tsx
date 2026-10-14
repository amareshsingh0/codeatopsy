"use client";
import { useEffect, useState } from "react";
export function RunProgress({ status = "queued", onStop }: { status?: string; onStop: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const stages = ["queued", "compiling", "running", "analyzing", "completed"];
  const stage = Math.max(0, stages.indexOf(status));
  return (
    <div className="panel run-progress" role="status">
      <div className="run-progress-top">
        <span className="status-dot" />
        <strong>
          {status === "queued"
            ? "Waiting for the execution worker"
            : status === "compiling"
              ? "Compiling the original source"
              : status === "analyzing"
                ? "Analyzing captured evidence"
                : "Executing tests and collecting evidence"}
        </strong>
        <span className="mono muted text-xs">{elapsed}s</span>
        <button className="btn" onClick={onStop}>
          Stop waiting
        </button>
      </div>
      <div className="progress-steps" aria-hidden="true">
        {stages.map((name, i) => (
          <span key={name} className={`progress-step ${i <= stage ? "active" : ""}`} />
        ))}
      </div>
      <p className="coverage-note">
        The worker may continue after you stop waiting. Long queues and trace collection can take additional
        time.
      </p>
    </div>
  );
}
