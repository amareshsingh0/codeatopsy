/**
 * C++ source-to-source instrumenter.
 *
 * Parses student code with a lightweight tokenizer and injects AUTOPSY_* probe
 * calls that record a JSONL execution trace at runtime (see assets/trace-runtime.hpp).
 * Every transform is semantics-preserving: conditions are wrapped (evaluated
 * exactly once), statements get probes appended *after* their terminating `;`,
 * and all probes are SFINAE-guarded in the runtime so they can never fail to
 * compile regardless of the probed type.
 */
import { tokenize, Tok } from "./tokenizer";

export interface InstrumentResult {
  /** instrumented source */
  code: string;
  /** number of probes injected */
  probes: number;
  /** human-readable notes about constructs that were skipped */
  notes: string[];
}

interface Insertion {
  pos: number; // byte offset
  text: string;
  seq: number;
}

const CONTROL_KEYWORDS = new Set([
  "if", "while", "for", "switch", "else", "do", "return", "case", "goto",
  "break", "continue", "using", "namespace", "template", "typedef", "try",
  "catch", "throw", "asm", "public", "private", "protected", "static_assert",
  "static_cast", "const_cast", "reinterpret_cast", "dynamic_cast", "new",
  "delete", "sizeof", "alignof", "typeid", "co_await", "co_yield", "co_return",
]);

const BUILTIN_TYPES = new Set([
  "bool", "char", "wchar_t", "char8_t", "char16_t", "char32_t", "short",
  "int", "long", "float", "double", "signed", "unsigned", "size_t", "ssize_t",
  "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
]);

const TYPE_QUALIFIERS = new Set(["const", "static", "volatile", "register", "constexpr", "unsigned", "signed", "long", "short"]);

const STREAMABLE_TYPES = new Set([
  "bool", "char", "wchar_t", "short", "int", "long", "float", "double",
  "signed", "unsigned", "size_t", "ssize_t", "long long", "unsigned long",
  "unsigned int", "unsigned long long", "unsigned char", "string", "std::string",
]);

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);

/** Is this a declarable scalar/whitelisted type we are willing to probe? */
function isProbeableType(base: string): boolean {
  if (STREAMABLE_TYPES.has(base)) return true;
  const m = /^(std::)?vector<(.+)>$/.exec(base);
  if (m) {
    const inner = m[2].trim();
    return STREAMABLE_TYPES.has(inner) || BUILTIN_TYPES.has(inner);
  }
  return false;
}

function cEscape(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return out.slice(0, 160);
}

type ScopeKind = "fn" | "ctrl" | "block" | "other" | "init";

export function instrument(src: string): InstrumentResult {
  const toks = tokenize(src);
  const notes: string[] = [];

  // ---- significant-token helpers ------------------------------------
  const isSig = (t: Tok) => t.type !== "comment" && t.type !== "preproc";
  const sig: number[] = [];
  for (let i = 0; i < toks.length; i++) if (isSig(toks[i])) sig.push(i);
  const S = (k: number): Tok | undefined => (k >= 0 && k < sig.length ? toks[sig[k]] : undefined);
  const st = (k: number): string => S(k)?.text ?? "";
  const sigCount = sig.length;

  // ---- bracket matching (paren/bracket/brace unified) ---------------
  const match = new Map<number, number>(); // sig idx -> matching sig idx
  {
    const stack: number[] = [];
    for (let k = 0; k < sigCount; k++) {
      const t = S(k)!;
      if (t.type === "punct" && "([{".includes(t.text)) stack.push(k);
      else if (t.type === "punct" && ")]}".includes(t.text)) {
        const o = stack.pop();
        if (o !== undefined) {
          match.set(o, k);
          match.set(k, o);
        }
      }
    }
  }

  // ---- function definitions at global depth -------------------------
  // sig index of body '{' -> { name, closeIdx }
  const fnOpen = new Map<number, { name: string; closeIdx: number }>();
  {
    const stack: number[] = [];
    for (let k = 0; k < sigCount; k++) {
      const t = S(k)!;
      if (t.type === "punct" && "([{".includes(t.text)) stack.push(k);
      else if (t.type === "punct" && ")]}".includes(t.text)) stack.pop();
      if (stack.length > 0) continue; // only global depth
      if (t.type !== "id" || CONTROL_KEYWORDS.has(t.text)) continue;
      if (st(k + 1) !== "(") continue;
      const prev = st(k - 1);
      if ([".", "->", "]", "~", "new", "::"].includes(prev) && prev !== "::") continue;
      const close = match.get(k + 1);
      if (close === undefined) continue;
      if (st(close + 1) !== "{") continue;
      if (st(k - 1) === "return") continue;
      fnOpen.set(close + 1, { name: t.text, closeIdx: match.get(close + 1)! });
      k = close; // skip params
    }
  }

  // ---- insertions ----------------------------------------------------
  const insertions: Insertion[] = [];
  let seqCounter = 0;
  const ins = (pos: number, text: string) => {
    if (text.length) insertions.push({ pos, text, seq: seqCounter++ });
  };

  // ---- scan ----------------------------------------------------------
  const scopeStack: ScopeKind[] = [];
  let pendingCtrl = false;
  let cur: number | null = null; // sig idx of current statement start
  let curFn = "";

  const inside = () => scopeStack.length > 0 && ["fn", "ctrl", "block"].includes(scopeStack[scopeStack.length - 1]);

  /** top-level split of sig range [a, b) by a punct */
  const splitTop = (a: number, b: number, sep: string): number[] => {
    const parts: number[] = [];
    const depthChars = "([{", closeChars = ")]}";
    let depth = 0;
    for (let k = a; k < b; k++) {
      const t = S(k)!;
      if (t.type === "punct") {
        if (depthChars.includes(t.text)) depth++;
        else if (closeChars.includes(t.text)) depth--;
        else if (t.text === sep && depth === 0) parts.push(k);
      }
    }
    return parts;
  };

  const wrapCond = (kwIdx: number, openIdx: number, mode: "bool" | "value") => {
    const closeIdx = match.get(openIdx);
    if (closeIdx === undefined || closeIdx === openIdx + 1) return; // empty cond
    const first = S(openIdx + 1)!;
    // `if (int x = f())` — declaration condition; leave alone
    if (first.type === "id" && (BUILTIN_TYPES.has(first.text) || TYPE_QUALIFIERS.has(first.text) || first.text === "auto")) {
      notes.push(`line ${kwIdx ? S(kwIdx)!.line : 0}: declaration-condition left uninstrumented`);
      return;
    }
    const kwLine = S(kwIdx)!.line;
    const condSrc = src.slice(toks[sig[openIdx + 1]].start, toks[sig[closeIdx - 1]].end);
    if (mode === "bool") {
      ins(toks[sig[openIdx]].end, ` AUTOPSY_BRANCH("${cEscape(condSrc)}", ${kwLine}, static_cast<bool>(`);
      ins(toks[sig[closeIdx]].start, `))`);
    } else {
      ins(toks[sig[openIdx]].end, ` AUTOPSY_SWITCH("${cEscape(condSrc)}", ${kwLine}, `);
      ins(toks[sig[closeIdx]].start, `)`);
    }
  };

  const wrapFor = (openIdx: number) => {
    const closeIdx = match.get(openIdx);
    if (closeIdx === undefined) return;
    const semis = splitTop(openIdx + 1, closeIdx, ";");
    const colons = splitTop(openIdx + 1, closeIdx, ":");
    if (colons.length > 0) {
      notes.push(`line ${S(openIdx)!.line}: range-for left uninstrumented`);
      return;
    }
    if (semis.length !== 2) return;
    const [s1, s2] = semis;
    // condition
    if (s2 > s1 + 1) {
      const condSrc = src.slice(toks[sig[s1 + 1]].start, toks[sig[s2 - 1]].end);
      const kwLine = S(openIdx)!.line;
      ins(toks[sig[s1 + 1]].start, ` AUTOPSY_BRANCH("${cEscape(condSrc)}", ${kwLine}, static_cast<bool>(`);
      ins(toks[sig[s2]].start, `))`);
    }
    // init decl `int i = 0` / `int i{0}` / assignment `i = 0`
    if (s1 > openIdx + 1) {
      wrapInitOrAssign(openIdx + 1, s1, s1);
    }
    // update: wrap each comma-separated simple mutation
    if (closeIdx > s2 + 1) {
      const commas = splitTop(s2 + 1, closeIdx, ",");
      const bounds = [s2 + 1, ...commas.map((c) => c + 1), closeIdx];
      for (let p = 0; p < bounds.length - 1; p++) {
        const a = bounds[p], b = bounds[p + 1];
        const target = simpleMutationTarget(a, b);
        if (target) {
          ins(toks[sig[a]].start, `(AUTOPSY_ASSIGNV("${target}", ${S(a)!.line}, `);
          ins(toks[sig[b - 1]].end, `))`);
        }
      }
    }
  };

  /** wrap `TYPE i = expr` or `i = expr` in a one-shot assign probe */
  const wrapInitOrAssign = (a: number, b: number, semiIdx: number) => {
    const first = S(a)!;
    // assignment: `i = 0`
    if (first.type === "id" && st(a + 1) === "=" && !CONTROL_KEYWORDS.has(first.text)) {
      ins(toks[sig[a + 1]].end, ` AUTOPSY_ASSIGNV("${first.text}", ${first.line}, `);
      ins(toks[sig[semiIdx]].start, `)`);
      return;
    }
    // declaration: walk a small type grammar
    let k = a;
    while (k < b && (S(k)!.type === "id" && TYPE_QUALIFIERS.has(S(k)!.text) || S(k)!.text === "const")) k++;
    let base = "";
    if (k < b && S(k)!.type === "id") {
      if (BUILTIN_TYPES.has(S(k)!.text)) {
        base = S(k)!.text;
        k++;
        // "long long", "unsigned long", etc.
        while (k < b && S(k)!.type === "id" && (BUILTIN_TYPES.has(S(k)!.text) || TYPE_QUALIFIERS.has(S(k)!.text))) {
          if (/^(int|long|short|char|double|float|unsigned|signed|long long)$/.test(S(k)!.text) || BUILTIN_TYPES.has(S(k)!.text)) {
            base += " " + S(k)!.text;
            k++;
          } else break;
        }
        base = base.trim();
      } else if (/^(std::)?(string|vector)$/.test(S(k)!.text)) {
        base = S(k)!.text === "string" ? "std::string" : S(k)!.text === "std::string" ? "std::string" : S(k)!.text;
        if (st(k + 1) === "<") {
          const closeT = match.get(k + 1);
          if (closeT !== undefined && closeT < b) {
            base += "<" + src.slice(toks[sig[k + 1]].end, toks[sig[closeT]].start).trim() + ">";
            k = closeT + 1;
          } else return;
        } else return; // vector without template arg — skip
        if (base === "vector") base = "std::" + base;
      } else return;
    } else return;
    // declarator
    const nameTok = S(k);
    if (!nameTok || nameTok.type !== "id" || CONTROL_KEYWORDS.has(nameTok.text)) return;
    if (st(k + 1) !== "=" && st(k + 1) !== "{") return; // uninitialized or ctor-paren — skip
    if (!isProbeableType(base)) return;
    const eqIdx = k + 1;
    ins(toks[sig[eqIdx]].end, ` AUTOPSY_ASSIGNV("${nameTok.text}", ${nameTok.line}, `);
    ins(toks[sig[semiIdx]].start, `)`);
  };

  /** if sig range [a,b) is a simple single-variable mutation, return the var name */
  const simpleMutationTarget = (a: number, b: number): string | null => {
    if (b - a < 2 || b - a > 6) return null;
    const t0 = S(a)!, t1 = S(a + 1)!;
    if (t0.type === "punct" && (t0.text === "++" || t0.text === "--") && t1.type === "id" && !CONTROL_KEYWORDS.has(t1.text) && b - a === 2) return t1.text;
    if (t0.type === "id" && !CONTROL_KEYWORDS.has(t0.text)) {
      if (t1.type === "punct" && (t1.text === "++" || t1.text === "--") && b - a === 2) return t0.text;
      if (t1.type === "punct" && ASSIGN_OPS.has(t1.text)) return t0.text;
    }
    return null;
  };

  const wrapReturn = (retIdx: number) => {
    const next = retIdx + 1;
    if (next >= sigCount) return;
    const nt = S(next)!;
    const fn = curFn || "main";
    if (nt.type === "punct" && nt.text === ";") {
      ins(toks[sig[next]].start, ` AUTOPSY_RETURNV("${fn}", ${nt.line})`);
      return;
    }
    if (nt.type === "punct" && nt.text === "{") return; // braced init list — skip
    // find terminating ';' at depth 0
    let depth = 0, k = next;
    for (; k < sigCount; k++) {
      const t = S(k)!;
      if (t.type === "punct") {
        if ("([{".includes(t.text)) depth++;
        else if (")]}".includes(t.text)) {
          if (depth === 0 && t.text === "}") return; // ran off — no semicolon
          depth--;
        } else if (t.text === ";" && depth === 0) break;
      }
    }
    if (k >= sigCount) return;
    ins(toks[sig[retIdx]].end, ` AUTOPSY_RETURN("${fn}", ${S(retIdx)!.line}, `);
    ins(toks[sig[k]].start, `)`);
  };

  const processStatement = (a: number, semiIdx: number) => {
    const first = S(a)!;
    const firstText = first.text;
    if (first.type === "id" && CONTROL_KEYWORDS.has(firstText)) return;
    const line = first.line;

    // ---- declaration? ----
    const decl = tryDeclaration(a, semiIdx);
    if (decl.length > 0) {
      for (const name of decl.slice(0, 4)) {
        ins(toks[sig[semiIdx]].end, ` AUTOPSY_ASSIGN("${name}", ${line}, ${name});`);
      }
      return;
    }
    if (first.type === "id" && (BUILTIN_TYPES.has(firstText) || TYPE_QUALIFIERS.has(firstText))) return;

    // ---- assignment / increment / cin ----
    const targets: string[] = [];
    const semis = [a, semiIdx + 1];
    void semis;
    let depth = 0;
    for (let k = a; k < semiIdx; k++) {
      const t = S(k)!;
      if (t.type === "punct") {
        if ("([{".includes(t.text)) depth++;
        else if (")]}".includes(t.text)) depth--;
        continue;
      }
      if (t.type !== "id" || CONTROL_KEYWORDS.has(t.text)) continue;
      const prev = S(k - 1);
      const nextT = S(k + 1);
      if (!nextT) continue;
      if (depth !== 0) continue;
      if (prev && prev.type === "punct" && [".", "->", "::"].includes(prev.text)) continue;
      // cin >> x
      if (prev && prev.type === "punct" && prev.text === ">>") {
        targets.push(t.text);
        continue;
      }
      if (prev && prev.type === "id" && prev.text === "cin") continue;
      if (nextT.type === "punct" && ASSIGN_OPS.has(nextT.text)) {
        targets.push(t.text);
        continue;
      }
      if (nextT.type === "punct" && (nextT.text === "++" || nextT.text === "--")) {
        targets.push(t.text);
        continue;
      }
    }
    // prefix ++/--
    for (let k = a; k < semiIdx; k++) {
      const t = S(k)!;
      if (t.type === "punct" && (t.text === "++" || t.text === "--") && depthSafe(k, a, semiIdx)) {
        const nt = S(k + 1);
        if (nt && nt.type === "id" && !CONTROL_KEYWORDS.has(nt.text)) targets.push(nt.text);
      }
    }
    const uniq = [...new Set(targets)].filter((n) => n !== "cin" && n !== "cout" && n !== "endl").slice(0, 3);
    for (const name of uniq) {
      ins(toks[sig[semiIdx]].end, ` AUTOPSY_ASSIGN("${name}", ${line}, ${name});`);
    }
  };

  const depthSafe = (k: number, a: number, semiIdx: number) => {
    let depth = 0;
    for (let j = a; j < k; j++) {
      const t = S(j)!;
      if (t.type === "punct") {
        if ("([{".includes(t.text)) depth++;
        else if (")]}".includes(t.text)) depth--;
      }
    }
    void semiIdx;
    return depth === 0;
  };

  /** minimal declaration recognizer; returns probed var names */
  const tryDeclaration = (a: number, semiIdx: number): string[] => {
    let k = a;
    while (k < semiIdx && S(k)!.type === "id" && TYPE_QUALIFIERS.has(S(k)!.text)) k++;
    if (k >= semiIdx) return [];
    const t = S(k)!;
    if (t.type !== "id") return [];
    let base = "";
    if (BUILTIN_TYPES.has(t.text)) {
      const words: string[] = [t.text];
      k++;
      while (k < semiIdx && S(k)!.type === "id" && (BUILTIN_TYPES.has(S(k)!.text) || TYPE_QUALIFIERS.has(S(k)!.text))) {
        words.push(S(k)!.text);
        k++;
      }
      base = words.filter((w) => w !== "const" && w !== "static" && w !== "constexpr" && w !== "volatile").join(" ");
    } else if (/^(std::)?(string|vector)$/.test(t.text)) {
      base = t.text.startsWith("std::") ? t.text : `std::${t.text}`;
      k++;
      if (base === "std::vector") {
        if (st(k) !== "<") return [];
        const closeT = match.get(k);
        if (closeT === undefined || closeT >= semiIdx) return [];
        base = base + "<" + src.slice(toks[sig[k + 1]]?.start ?? 0, toks[sig[closeT]]?.start ?? 0).trim() + ">";
        k = closeT + 1;
      }
    } else return [];

    const names: string[] = [];
    let guard = 0;
    while (k < semiIdx && guard++ < 8) {
      const nameTok = S(k)!;
      if (!nameTok || nameTok.type !== "id" || CONTROL_KEYWORDS.has(nameTok.text)) return [];
      const name = nameTok.text;
      let nk = k + 1;
      // optional array suffix / pointer / reference already consumed as type? (kept simple)
      if (S(nk)?.type === "punct" && S(nk)!.text === "[") {
        const closeB = match.get(nk);
        if (closeB === undefined) return [];
        nk = closeB + 1;
      }
      const initTok = S(nk);
      const hasInit =
        initTok && initTok.type === "punct" && (initTok.text === "=" || initTok.text === "{" || initTok.text === "(");
      if (hasInit && isProbeableType(base)) names.push(name);
      // advance to next comma or end
      let depth = 0;
      let j = nk;
      for (; j < semiIdx; j++) {
        const jt = S(j)!;
        if (jt.type === "punct") {
          if ("([{".includes(jt.text)) depth++;
          else if (")]}".includes(jt.text)) depth--;
          else if (jt.text === "," && depth === 0) break;
        }
      }
      k = j + 1;
    }
    return names;
  };

  // ---- main scan loop -------------------------------------------------
  let ctrlHeaderEnd = -1; // sig idx of ')' closing the current if/while/for/switch header
  for (let k = 0; k < sigCount; k++) {
    if (k <= ctrlHeaderEnd) continue; // inside a control header: never a statement
    const t = S(k)!;

    if (t.type === "punct") {
      if (t.text === "{") {
        const fn = fnOpen.get(k);
        if (fn) {
          curFn = fn.name;
          scopeStack.push("fn");
          cur = null;
          ins(t.end, ` AUTOPSY_CALL("${fn.name}", ${t.line});`);
          if (fn.name === "main") ins(t.end, ` AUTOPSY_INIT();`);
          // implicit return at function end keeps call-depth balanced
          const closeTok = match.get(k);
          if (closeTok !== undefined) {
            ins(toks[sig[closeTok]].start, ` AUTOPSY_RETURNV("${fn.name}", ${t.line});`);
          }
        } else if (pendingCtrl) {
          scopeStack.push("ctrl");
          cur = null;
        } else if (cur !== null) {
          scopeStack.push("init");
        } else {
          const prev = S(k - 1);
          const prev2 = S(k - 2);
          const isTypeDecl =
            (prev && prev.type === "id" && ["struct", "class", "union", "enum", "namespace"].includes(prev.text)) ||
            (prev2 && prev2.type === "id" && ["enum", "union"].includes(prev2.text));
          const isLambda =
            prev && prev.type === "punct" && prev.text === ")" &&
            (() => {
              const open = match.get(sig[k - 1]);
              return open !== undefined && st(open - 1) === "]";
            })();
          scopeStack.push(isTypeDecl ? "other" : isLambda ? "block" : "block");
          cur = null;
        }
        pendingCtrl = false;
        continue;
      }
      if (t.text === "}") {
        const fn = [...fnOpen.entries()].find(([, v]) => v.closeIdx === k);
        const popped = scopeStack.pop();
        if (fn) curFn = "";
        if (popped !== "init") cur = null;
        continue;
      }
      if (t.text === ";") {
        if (cur !== null && inside()) processStatement(cur, k);
        if (scopeStack[scopeStack.length - 1] !== "init") cur = null;
        continue;
      }
    }

    if (t.type === "id") {
      const nextT = S(k + 1);
      const isCtrlKw = ["if", "while", "switch", "for"].includes(t.text);
      if (isCtrlKw && nextT && nextT.type === "punct" && nextT.text === "(") {
        if (t.text === "for") wrapFor(k + 1);
        else wrapCond(k, k + 1, t.text === "switch" ? "value" : "bool");
        const headerClose = match.get(k + 1);
        if (headerClose !== undefined) ctrlHeaderEnd = headerClose;
        pendingCtrl = true;
        cur = cur ?? k; // statement may start here (e.g. `if (...)`)
        continue;
      }
      if (t.text === "else" || t.text === "do" || t.text === "try" || t.text === "catch") {
        pendingCtrl = true;
        cur = cur ?? k;
        continue;
      }
      if (t.text === "return" && inside()) {
        wrapReturn(k);
        cur = cur ?? k;
        continue;
      }
    }

    if (cur === null) cur = k;
  }

  // ---- apply insertions ------------------------------------------------
  let buf = Buffer.from(src, "utf8");
  const sorted = [...insertions].sort((x, y) => y.pos - x.pos || y.seq - x.seq);
  for (const item of sorted) {
    buf = Buffer.concat([
      buf.subarray(0, item.pos),
      Buffer.from(item.text, "utf8"),
      buf.subarray(item.pos),
    ]);
  }

  return { code: buf.toString("utf8"), probes: insertions.length, notes };
}
