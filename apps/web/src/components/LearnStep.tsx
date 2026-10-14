import type { TraceEvent } from "@codeautopsy/schemas";
export function LearnStep({ event, previous }: { event?: TraceEvent; previous: Map<string, string> }) {
  if (!event) return null;
  const sentences: Record<string, { title: string; text: string }> = {
    assign: {
      title: `A value ${previous.has(event.name ?? "") ? "changed" : "was recorded"}.`,
      text: `Think of ${event.name ?? "this variable"} as a labelled box. It now holds ${event.value ?? "an uncaptured value"}.${previous.has(event.name ?? "") ? ` Its previous recorded value was ${previous.get(event.name ?? "")}.` : ""}`,
    },
    branch: {
      title: "The program answered a question.",
      text: `It checked ${event.cond ?? "a condition"}. The answer was ${event.taken ? "true (yes)" : "false (no)"}. That answer controls which path the program takes.`,
    },
    call: {
      title: "A function started.",
      text: `${event.fn ?? "A function"} is a named set of instructions. The program entered it. The call stack shows which recorded functions are still active.`,
    },
    return: {
      title: "A function sent an answer back.",
      text: `${event.fn ?? "The function"} returned ${event.value ?? "an uncaptured value"}. The program continues with the caller.`,
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
      <div className="learning-key">
        <span>Variable = labelled box</span>
        <span>Index = position, starting at 0</span>
        <span>Condition = a yes/no question</span>
      </div>
    </aside>
  );
}
