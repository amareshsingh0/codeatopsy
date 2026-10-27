import type { ExecutionResult } from "@codeautopsy/schemas";

/** Preserve all verdicts, but bound previews so the result fits the HTTP/DB budget. */
export function boundResultPreviews(result: ExecutionResult): ExecutionResult {
  let outputBytes = 192 * 1024;
  for (const verdict of result.verdicts) {
    for (const key of ["output", "stderr"] as const) {
      const value = verdict[key];
      if (!value) continue;
      const bytes = Buffer.from(value);
      if (bytes.length > outputBytes)
        verdict[key] = bytes.subarray(0, outputBytes).toString("utf8") + "\n[Output preview truncated]";
      outputBytes = Math.max(0, outputBytes - bytes.length);
    }
  }
  let eventBytes = 900 * 1024;
  for (const collection of [result.studentTraces, result.referenceTraces]) {
    for (const trace of Object.values(collection)) {
      let kept = 0;
      for (const event of trace.events) {
        const size = Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
        if (size > eventBytes) break;
        eventBytes -= size;
        kept++;
      }
      if (kept !== trace.events.length) {
        trace.events = trace.events.slice(0, kept);
        trace.meta.truncated = true;
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 1500 * 1024) {
    // Deterministic diagnostics can contain repeated source fragments. Verdicts
    // and captured prefix events remain intact when the report preview is large.
    result.report = null;
  }
  return result;
}
