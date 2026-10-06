// TraceEvent — TS side of the schema in blueprint section 8.
// Hand-mirrored against trace_event.py — see that file's docstring for the
// plan to generate both from one source once the discriminated union for
// `payload` is designed (Week 3-4).

export type TraceEvent = {
  schemaVersion: "1";
  executionId: string;
  eventId: string;
  sequence: number;
  frameId: string;
  operationId: string;
  source: {
    fileId: string;
    startLine: number;
    startColumn: number;
    endLine?: number;
    endColumn?: number;
  };
  kind:
    | "ASSIGN" | "READ" | "WRITE"
    | "CONDITION" | "BRANCH"
    | "CALL" | "RETURN"
    | "CHECKPOINT" | "OUTPUT"
    | "DIAGNOSTIC";
  payload: Record<string, unknown>;
  dataDependencies: string[];
  controlDependencies: string[];
};
