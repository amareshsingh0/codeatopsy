/**
 * Deterministic rule-based diagnosis. Always runs; its output is the fallback
 * when no LLM provider is configured. Produces ranked hypotheses from the
 * evidence digest + divergence + verdicts.
 */
import type {
  AutopsyReport,
  Divergence,
  ExecutionResult,
  Hypothesis,
  Trace,
} from "@codeautopsy/schemas";
import type { EvidenceDigest } from "@codeautopsy/trace-core";
import { eventText } from "@codeautopsy/trace-core";

export function diagnose(
  result: ExecutionResult,
  studentTrace: Trace | undefined,
  referenceTrace: Trace | undefined,
  divergence: Divergence | null,
  evidence: EvidenceDigest,
  bugHint?: string,
): { headline: string; hypotheses: Hypothesis[]; narrative: string } {
  const hypotheses: Hypothesis[] = [];

  if (result.compileError) {
    const c = result.compileError;
    return {
      headline: `Compile error (${c.side} code)`,
      hypotheses: [
        {
          id: "compile-error",
          title: "The code did not compile",
          confidence: 1,
          mechanism:
            "The compiler rejected the program, so no execution evidence exists. Fix the syntax/type errors first.",
          lines: [],
          evidence: [{ description: c.stderr.slice(0, 600) }],
        },
      ],
      narrative: compileNarrative(c.stderr),
    };
  }

  if (result.verdicts.some((v) => v.status === "timeout")) {
    const hot = evidence.findings.find((f) => f.id === "hot-loop" || f.id === "truncated");
    hypotheses.push({
      id: "non-termination",
      title: "Non-terminating loop",
      confidence: hot ? 0.9 : 0.6,
      mechanism: hot
        ? hot.detail
        : "A test exceeded the time limit, which usually means a loop never reaches its exit condition.",
      lines: [],
      evidence: [],
    });
  }

  if (divergence && studentTrace) {
    const d = divergence;
    const ev = studentTrace.events.find((e) => e.seq === d.studentSeq);

    if (d.kind === "control" && ev?.kind === "branch" && ev.cond) {
      const refEvent = referenceTrace?.events.find((e) => e.seq === d.referenceSeq);
      const offByOne = looksLikeOffByOne(ev.cond, refEvent?.cond);
      hypotheses.push({
        id: "off-by-one-guard",
        title: offByOne ? "Off-by-one in a loop/branch guard" : "Wrong condition outcome",
        confidence: offByOne ? 0.85 : 0.7,
        mechanism: offByOne
          ? `At line ${d.studentLine}, your condition \`${ev.cond}\` became false one step too early. The reference condition \`${refEvent?.cond ?? d.referenceText}\` was still true for the same state — your loop boundary excludes exactly one valid candidate (the classic < vs <= mistake on an inclusive interval).`
          : `At line ${d.studentLine}, your condition \`${ev.cond}\` evaluated differently from the reference (\`${refEvent?.cond ?? "?"}\`).`,
        lines: d.studentLine ? [d.studentLine] : [],
        evidence: [
          { description: `Your trace: ${d.studentText}`, studentEventSeq: d.studentSeq },
          { description: `Reference trace: ${d.referenceText}`, referenceEventSeq: d.referenceSeq },
        ],
      });
    } else if (ev?.kind === "assign" && ev.name) {
      const refEvent = referenceTrace?.events.find((e) => e.seq === d.referenceSeq);
      hypotheses.push({
        id: "wrong-update",
        title: `Wrong update to \`${ev.name}\``,
        confidence: 0.65,
        mechanism: `At line ${d.studentLine}, \`${ev.name}\` became \`${ev.value}\`, but the reference has \`${refEvent?.value ?? d.referenceText}\`. The update expression (or the values it depends on) is computed differently.`,
        lines: d.studentLine ? [d.studentLine] : [],
        evidence: [
          { description: `Your trace: ${d.studentText}`, studentEventSeq: d.studentSeq },
          { description: `Reference trace: ${d.referenceText}`, referenceEventSeq: d.referenceSeq },
        ],
      });
    } else if (d.kind === "missing" || d.kind === "extra") {
      hypotheses.push({
        id: "control-flow",
        title: d.kind === "missing" ? "Your code stops earlier than the reference" : "Your code does extra work",
        confidence: 0.55,
        mechanism: `The traces desynced: your execution shows “${d.studentText}” where the reference shows “${d.referenceText}”. A branch or loop boundary is shaped differently.`,
        lines: d.studentLine ? [d.studentLine] : [],
        evidence: [{ description: `${d.studentText} vs ${d.referenceText}` }],
      });
    }

    // supporting hypothesis: variables that already disagree at divergence time
    const disagreeing = evidence.variableState.filter((v) => v.student !== v.reference);
    if (disagreeing.length) {
      hypotheses.push({
        id: "state-delta",
        title: "Execution state started to differ here",
        confidence: 0.5,
        mechanism: `At the divergence point these variables already held different values: ${disagreeing
          .map((v) => `\`${v.name}\` you=${v.student} / ref=${v.reference}`)
          .join(", ")}. The earliest differing variable is the best place to look.`,
        lines: [],
        evidence: disagreeing.map((v) => ({ description: `${v.name}: you=${v.student}, ref=${v.reference}` })),
      });
    }
  }

  for (const f of evidence.findings) {
    hypotheses.push({
      id: f.id,
      title: f.title,
      confidence: 0.4,
      mechanism: f.detail,
      lines: f.lines,
      evidence: f.seqs.map((s) => ({ description: `trace event #${s}` })),
    });
  }

  hypotheses.sort((a, b) => b.confidence - a.confidence);
  if (bugHint && hypotheses.length && hypotheses[0].confidence >= 0.6) {
    // problem authors can supply the known bug class; surface it as corroboration
    hypotheses.push({
      id: "problem-hint",
      title: "Known bug pattern for this problem",
      confidence: 0.35,
      mechanism: bugHint,
      lines: [],
      evidence: [],
    });
  }

  const headline = divergence
    ? `${headlineFor(result)} — first divergence on test \`${divergence.testId}\`: ${divergence.studentText} (reference: ${divergence.referenceText})`
    : referenceTrace
      ? `${headlineFor(result)} — but the execution traces match the reference. The bug likely lives outside the instrumented statements (e.g. output formatting).`
      : headlineFor(result);

  return { headline, hypotheses, narrative: narrative(headline, hypotheses, evidence, divergence, result, !!referenceTrace) };
}

function looksLikeOffByOne(studentCond: string, refCond?: string): boolean {
  if (!refCond) return false;
  const s = studentCond.replace(/\s+/g, "");
  const r = refCond.replace(/\s+/g, "");
  if (s === r) return false;
  // `<` vs `<=`, `>` vs `>=` on otherwise identical text
  return s.replace("<=", "<") === r.replace("<=", "<") || s.replace(">=", ">") === r.replace(">=", ">");
}

function headlineFor(result: ExecutionResult): string {
  const failed = result.verdicts.filter((v) => v.status !== "accepted");
  if (result.compileError) return "Compile error";
  if (failed.some((v) => v.status === "timeout")) return "Time limit exceeded";
  if (failed.length === result.verdicts.length && result.verdicts.length > 0) return "Wrong answer on every test";
  if (failed.length) return "Wrong answer";
  return "All tests passed";
}

function narrative(
  headline: string,
  hypotheses: Hypothesis[],
  evidence: EvidenceDigest,
  divergence: Divergence | null,
  result: ExecutionResult,
  hasReference = true,
): string {
  const md: string[] = [];
  md.push(`## Autopsy Report\n`);
  md.push(`**${headline}**\n`);
  md.push(`**Tests:** ${evidence.verdictSummary}\n`);

  if (divergence) {
    md.push(`### First divergence (test \`${divergence.testId}\`)\n`);
    md.push(`| | your execution | reference execution |`);
    md.push(`|---|---|---|`);
    md.push(`| event | ${divergence.studentText} | ${divergence.referenceText} |`);
    if (divergence.studentLine || divergence.referenceLine) {
      md.push(`| line | ${divergence.studentLine ?? "?"} | ${divergence.referenceLine ?? "?"} |`);
    }
    md.push("");
  }

  if (hypotheses.length) {
    md.push(`### Root-cause hypotheses (ranked)\n`);
    hypotheses.forEach((h, i) => {
      md.push(`**${i + 1}. ${h.title}** — confidence ${(h.confidence * 100).toFixed(0)}%\n`);
      md.push(h.mechanism + "\n");
    });
  }

  const verdictLines = result.verdicts
    .map((v) => `- \`${v.testId}\`: **${v.status}** (${v.durationMs} ms)${v.detail ? ` — ${v.detail}` : ""}`)
    .join("\n");
  if (verdictLines) {
    md.push(`### Per-test verdicts\n${verdictLines}\n`);
  }

  if (!hasReference && !divergence) {
    md.push(
      `### About this report\nStandalone run (no reference solution) — the report is built from your execution trace alone: step through it in the player above to inspect every assignment and branch.\n`,
    );
  }

  return md.join("\n");
}

function compileNarrative(stderr: string): string {
  return `## Autopsy Report\n\n**Compile error** — the compiler rejected the program before any execution.\n\n\`\`\`\n${stderr.slice(0, 1500)}\n\`\`\`\n`;
}
