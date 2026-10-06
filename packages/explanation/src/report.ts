/**
 * buildReport — orchestrates the full explanation pipeline:
 * evidence digest → rule-based diagnosis → optional LLM narrative.
 */
import type { AutopsyReport, Divergence, ExecutionResult, Trace } from "@codeautopsy/schemas";
import { buildEvidence, type EvidenceDigest } from "@codeautopsy/trace-core";
import { diagnose } from "./rules";
import { explainWithLlm } from "./llm";

export async function buildReport(
  result: ExecutionResult,
  studentTrace: Trace | undefined,
  referenceTrace: Trace | undefined,
  divergence: Divergence | null,
  bugHint?: string,
): Promise<{ report: AutopsyReport; evidence: EvidenceDigest }> {
  const evidence = buildEvidence(result, studentTrace, referenceTrace, divergence);
  const { headline, hypotheses, narrative } = diagnose(
    result,
    studentTrace,
    referenceTrace,
    divergence,
    evidence,
    bugHint,
  );

  const report: AutopsyReport = {
    headline,
    divergence,
    hypotheses,
    narrative,
    provider: "rules",
  };

  const llm = await explainWithLlm(evidence);
  if (llm) {
    report.provider = llm.provider;
    report.narrative = llm.narrative;
  }

  return { report, evidence };
}
