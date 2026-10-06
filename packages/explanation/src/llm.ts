/**
 * Optional LLM narrative layer. Only activates when a free-tier API key is
 * present in the environment; otherwise the caller falls back to the
 * deterministic rules narrative. The LLM receives the evidence digest produced
 * by trace-core — never raw source code of the reference solution.
 */
import type { EvidenceDigest } from "@codeautopsy/trace-core";

export interface LlmResult {
  provider: "gemini" | "openrouter";
  narrative: string;
}

const SYSTEM_PROMPT = `You are CodeAutopsy, an expert algorithm-debugging assistant.
You receive structured evidence comparing a student's C++ execution against a correct reference execution: test verdicts, the first divergence point, nearby trace events, and variable states.
Write a concise, encouraging markdown diagnosis for a student learning algorithms:
1. **What happened** — one or two sentences on the failure mode.
2. **The evidence** — walk through the divergence concretely (use the variable values).
3. **The fix** — what to change in their code and why. Do NOT rewrite the whole program.
Never invent evidence that is not in the digest. Keep it under 250 words. Reply with markdown only.`;

function digestToPrompt(d: EvidenceDigest): string {
  const parts: string[] = [];
  parts.push(`Test results: ${d.verdictSummary}`);
  if (d.divergence) {
    parts.push(
      `First divergence on test ${d.divergence.testId} (kind: ${d.divergence.kind}):`,
      `  student:   ${d.divergence.student}${d.divergence.studentLine ? ` (line ${d.divergence.studentLine})` : ""}`,
      `  reference: ${d.divergence.reference}${d.divergence.referenceLine ? ` (line ${d.divergence.referenceLine})` : ""}`,
    );
  }
  if (d.variableState.length) {
    parts.push(
      "Variable state at divergence:",
      ...d.variableState.map((v) => `  ${v.name}: student=${v.student} reference=${v.reference}`),
    );
  }
  if (d.context.length) {
    parts.push(
      "Nearby trace events:",
      ...d.context.map((c) => `  [${c.side} #${c.seq} line ${c.line}] ${c.text}`),
    );
  }
  if (d.findings.length) {
    parts.push("Findings:", ...d.findings.map((f) => `  - ${f.title}: ${f.detail}`));
  }
  return parts.join("\n");
}

async function callGemini(key: string, digest: EvidenceDigest, signal: AbortSignal): Promise<string> {
  const model = process.env.AUTOPSY_GEMINI_MODEL || "gemini-2.0-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: digestToPrompt(digest) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("gemini: empty response");
  return text;
}

async function callOpenRouter(key: string, digest: EvidenceDigest, signal: AbortSignal): Promise<string> {
  const model = process.env.AUTOPSY_OPENROUTER_MODEL || "google/gemini-2.0-flash-exp:free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    signal,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: digestToPrompt(digest) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("openrouter: empty response");
  return text;
}

export async function explainWithLlm(digest: EvidenceDigest): Promise<LlmResult | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!geminiKey && !openrouterKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    if (geminiKey) {
      return { provider: "gemini", narrative: await callGemini(geminiKey, digest, controller.signal) };
    }
    return { provider: "openrouter", narrative: await callOpenRouter(openrouterKey!, digest, controller.signal) };
  } catch {
    return null; // fall back to rules narrative silently
  } finally {
    clearTimeout(timer);
  }
}
