import type { ExecutionResult } from "@codeautopsy/schemas";
export interface Diagnostic {
  title: string;
  message: string;
  line?: number;
  column?: number;
  severity: "error" | "warning";
  testId?: string;
  detail?: string;
}
export function locateDiagnostic(text: string): { line?: number; column?: number } {
  const python = /File ["'][^"']*\.(?:py)["'], line (\d+)/g;
  const matches = [...text.matchAll(python)];
  if (matches.length) return { line: Number(matches[matches.length - 1][1]) };
  const location = /(?:src\.(?:cpp|c)|main\.(?:cjs|mjs|js)|[A-Za-z_$][\w$]*\.java):(\d+)(?::(\d+))?/.exec(
    text,
  );
  return location ? { line: Number(location[1]), column: location[2] ? Number(location[2]) : undefined } : {};
}
export function getDiagnostics(result: ExecutionResult): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (result.compileError) {
    const text = result.compileError.stderr;
    const message =
      text.split("\n").find((line) => /error:|fatal error:/.test(line)) ??
      text.split("\n").find(Boolean) ??
      "Compiler rejected the source.";
    diagnostics.push({
      title: "Compilation stopped",
      message,
      detail: text,
      severity: "error",
      ...locateDiagnostic(text),
    });
  }
  for (const verdict of result.verdicts) {
    if (verdict.status === "accepted") continue;
    const text = verdict.stderr ?? verdict.detail ?? "";
    const message =
      text.split("\n").find((line) => /(?:\w*Error|Exception|error):/.test(line)) ??
      verdict.detail ??
      text.split("\n").find(Boolean);
    diagnostics.push({
      title:
        verdict.status === "timeout"
          ? "Time limit reached"
          : verdict.status === "wrong_answer"
            ? "Output differs"
            : "Program stopped",
      message:
        verdict.status === "timeout"
          ? `Test ${verdict.testId} exceeded its execution budget. Inspect repeated steps and algorithm cost.`
          : (message ?? "The program exited unsuccessfully."),
      severity: "error",
      testId: verdict.testId,
      detail: text || undefined,
      ...locateDiagnostic(text),
    });
  }
  for (const message of result.warnings ?? [])
    diagnostics.push({ title: "Trace coverage", message, severity: "warning" });
  if (result.error)
    diagnostics.push({ title: "Execution unavailable", message: result.error, severity: "error" });
  return diagnostics;
}
