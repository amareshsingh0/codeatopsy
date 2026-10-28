"use client";
import { Icon } from "./Icon";
export type WorkspaceView = "edit" | "replay" | "evidence";
export function WorkspaceViews({
  view,
  onChange,
  replayReady,
  resultReady,
  running,
}: {
  view: WorkspaceView;
  onChange: (view: WorkspaceView) => void;
  replayReady: boolean;
  resultReady: boolean;
  running: boolean;
}) {
  return (
    <div className="workspace-views">
      <nav aria-label="Workspace views">
        {(
          [
            ["edit", "Code & input", "code"],
            ["replay", "Visual replay", "layers"],
            ["evidence", "Run evidence", "check"],
          ] as const
        ).map(([key, label, icon], i) => (
          <button
            type="button"
            key={key}
            aria-pressed={view === key}
            disabled={key === "replay" ? !replayReady : key === "evidence" ? !resultReady : false}
            className={view === key ? "selected" : ""}
            onClick={() => onChange(key)}
          >
            <span className="view-number">{i + 1}</span>
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <p role="status">
        {running
          ? "Running your original code and collecting evidence…"
          : resultReady
            ? "Run complete. Explore the evidence at your own pace."
            : "Write or choose code, run it, then explore what happened."}
      </p>
    </div>
  );
}
