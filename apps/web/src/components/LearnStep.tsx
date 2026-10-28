import type { TraceEvent } from "@codeautopsy/schemas";
import { compactValue, valueChanges } from "@/lib/replay-insights";
export function LearnStep({ event, previous }: { event?: TraceEvent; previous: Map<string, string> }) {
  if (!event) return null;
  const delta =
    event.kind === "assign" ? valueChanges(previous.get(event.name ?? ""), event.value ?? "?") : null;
  const sentences: Record<string, { title: string; text: string }> = {
    assign: {
      title: delta?.first
        ? `Meet ${event.name ?? "this variable"}.`
        : delta?.count
          ? `${event.name ?? "A value"} changed.`
          : `${event.name ?? "A value"} stayed the same.`,
      text: delta?.first
        ? "A variable is a labelled box. This is its first captured value; it may have existed earlier."
        : delta?.count
          ? `Compare the captured values below. ${delta.count > 1 ? `${delta.count} positions or fields changed.` : "One recorded value changed."}`
          : "The recorder observed the same value again. An observation does not always mean a change.",
    },
    branch: {
      title: "The program answered a question.",
      text: `It checked ${compactValue(event.cond ?? "a condition", 140)}. The answer was ${event.taken ? "true (yes)" : "false (no)"}. That answer controls which path the program takes.`,
    },
    call: {
      title: "A function started.",
      text: `${event.fn ?? "A function"} is a named set of instructions. The program entered it. The call stack shows which recorded functions are still active.`,
    },
    return: {
      title: "A function sent an answer back.",
      text: `${event.fn ?? "The function"} returned ${compactValue(event.value ?? "an uncaptured value")}. The program continues with the caller.`,
    },
    returnvoid: {
      title: "A function finished.",
      text: `${event.fn ?? "The function"} finished without a recorded return value.`,
    },
    line: {
      title: "The next instruction was reached.",
      text: `The recorder reached source line ${event.line}. No changed variable was captured in this event. Open the source to see the instruction.`,
    },
    output: {
      title: "The program produced output.",
      text: "Output is what the program writes for us to read. The output panel shows the original run's captured text.",
    },
  };
  const story = sentences[event.kind];
  return (
    <aside className="learn-step">
      <span className="eyebrow">LET’S UNDERSTAND THIS STEP</span>
      <h3>{story.title}</h3>
      <p>{story.text}</p>
      {delta && delta.changes.length > 0 && (
        <div className="change-cards">
          {delta.changes.slice(0, 3).map((change) => (
            <div className="change-card" key={change.location}>
              <span className="mono">
                {event.name}
                {change.location}
              </span>
              <div>
                <span className="change-before" title={change.before}>
                  {compactValue(change.before, 64)}
                </span>
                <span aria-label="became">→</span>
                <strong className="mono" title={change.after}>
                  {compactValue(change.after, 64)}
                </strong>
              </div>
            </div>
          ))}
          {delta.count > 3 && (
            <span className="muted">+{delta.count - 3} more changes in the captured value</span>
          )}
        </div>
      )}
      <details className="learning-glossary">
        <summary>New to coding? Three useful ideas</summary>
        <div className="learning-key">
          <span>Variable = labelled box</span>
          <span>Index = position, starting at 0</span>
          <span>Condition = a yes/no question</span>
        </div>
      </details>
    </aside>
  );
}
