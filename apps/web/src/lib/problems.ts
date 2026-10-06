import "server-only";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Problem } from "@codeautopsy/schemas";

export type PublicProblem = Omit<Problem, "referenceSource" | "studentSource"> & {
  studentSource: string; // demo code IS shown to students
};

const PROBLEMS_DIR = process.env.AUTOPSY_PROBLEMS_DIR
  ? join(process.cwd(), process.env.AUTOPSY_PROBLEMS_DIR)
  : join(process.cwd(), "..", "..", "problems");

function readProblem(slug: string): Problem | null {
  const dir = join(PROBLEMS_DIR, slug);
  const metaPath = join(dir, "problem.json");
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Omit<
      Problem,
      "referenceSource" | "studentSource"
    >;
    const referenceSource = readFileSync(join(dir, "reference.cpp"), "utf8");
    const studentSource = readFileSync(join(dir, "student.cpp"), "utf8");
    return Problem.parse({ ...meta, referenceSource, studentSource });
  } catch (err) {
    console.error(`[problems] failed to load "${slug}":`, err);
    return null;
  }
}

export function listProblems(): PublicProblem[] {
  if (!existsSync(PROBLEMS_DIR)) return [];
  const out: PublicProblem[] = [];
  for (const entry of readdirSync(PROBLEMS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = readProblem(entry.name);
    if (p) out.push(toPublic(p));
  }
  return out;
}

export function getProblem(slug: string): { problem: Problem } | null {
  const p = readProblem(slug);
  return p ? { problem: p } : null;
}

/** strip the hidden reference solution before sending to the browser */
export function toPublic(p: Problem): PublicProblem {
  const { referenceSource: _ref, ...rest } = p;
  void _ref;
  return rest;
}

/** full problem (with reference source) — used when dispatching execution jobs */
export function getFullProblem(slug: string): Problem | null {
  const p = readProblem(slug);
  return p;
}
