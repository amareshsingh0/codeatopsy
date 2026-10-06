/**
 * Minimal C/C++ tokenizer — no dependencies, UTF-8 byte offsets, 1-based lines.
 * Produces a flat token stream good enough for statement-level surgery on
 * student algorithm submissions (strings/comments/chars are opaque atoms,
 * preprocessor lines are single tokens).
 */

export type TokType = "id" | "num" | "str" | "chr" | "punct" | "comment" | "preproc";

export interface Tok {
  type: TokType;
  text: string;
  /** byte offset of first byte (UTF-8) */
  start: number;
  /** byte offset one past last byte */
  end: number;
  /** 1-based line */
  line: number;
}

const PUNCTS = [
  "<<=", ">>=", "...", "->*", ".*",
  "::", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=",
  "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "(", ")", "[", "]", "{", "}", ";", ":", "?", ".", ",", "+", "-", "*", "/", "%",
  "=", "<", ">", "!", "&", "|", "^", "~", "@", "\\",
];

export function isIdStart(c: string): boolean {
  return /[A-Za-z_]/.test(c);
}
export function isIdChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

export function tokenize(src: string): Tok[] {
  const bytes = Buffer.from(src, "utf8");
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = bytes.length;

  const lineAt = (start: number): number => {
    let l = 1;
    for (let k = 0; k < start && k < n; k++) if (bytes[k] === 0x0a) l++;
    return l;
  };
  const text = (a: number, b: number) => bytes.subarray(a, b).toString("utf8");
  const at = (off: number) => String.fromCharCode(bytes[off]);

  while (i < n) {
    const c = at(i);
    // whitespace
    if (c === "\n" || c === "\r" || c === " " || c === "\t" || c === "\f" || c === "\v") {
      if (c === "\n") line++;
      i++;
      continue;
    }
    const start = i;
    const startLine = line;

    // preprocessor directive (must be first non-ws on line)
    if (c === "#") {
      while (i < n && at(i) !== "\n") {
        if (at(i) === "\\" && i + 1 < n && at(i + 1) === "\n") { line++; i += 2; continue; }
        i++;
      }
      toks.push({ type: "preproc", text: text(start, i), start, end: i, line: startLine });
      continue;
    }
    // line comment
    if (c === "/" && i + 1 < n && at(i + 1) === "/") {
      while (i < n && at(i) !== "\n") i++;
      toks.push({ type: "comment", text: text(start, i), start, end: i, line: startLine });
      continue;
    }
    // block comment
    if (c === "/" && i + 1 < n && at(i + 1) === "*") {
      i += 2;
      while (i < n && !(at(i) === "*" && i + 1 < n && at(i + 1) === "/")) {
        if (at(i) === "\n") line++;
        i++;
      }
      i = Math.min(i + 2, n);
      toks.push({ type: "comment", text: text(start, i), start, end: i, line: startLine });
      continue;
    }
    // string
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n) {
        if (at(i) === "\\") { i += 2; continue; }
        if (at(i) === q) { i++; break; }
        if (at(i) === "\n") { line++; i++; continue; } // unterminated; be lenient
        i++;
      }
      toks.push({ type: q === '"' ? "str" : "chr", text: text(start, i), start, end: i, line: startLine });
      continue;
    }
    // raw string R"delim(...)delim"
    if (c === "R" && i + 1 < n && at(i + 1) === '"') {
      let d = i + 2;
      while (d < n && at(d) !== "(") d++;
      const delim = text(i + 2, d);
      const close = `)${delim}"`;
      i = d + 1;
      const idx = bytes.indexOf(Buffer.from(close), i);
      i = idx === -1 ? n : idx + close.length;
      toks.push({ type: "str", text: text(start, i), start, end: i, line: startLine });
      continue;
    }
    // identifier / number
    if (isIdStart(c)) {
      while (i < n && isIdChar(at(i))) i++;
      toks.push({ type: "id", text: text(start, i), start, end: i, line: startLine });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && i + 1 < n && /[0-9]/.test(at(i + 1)))) {
      while (i < n && /[0-9a-fA-FxXuUlLfF.eE+-]/.test(at(i))) {
        // don't swallow +/- unless part of exponent — good-enough heuristic
        if ((at(i) === "+" || at(i) === "-") && !/[eE]/.test(at(i - 1))) break;
        i++;
      }
      toks.push({ type: "num", text: text(start, i), start, end: i, line: startLine });
      continue;
    }
    // punctuation, maximal munch
    const p = PUNCTS.find((p) => bytes.subarray(i, i + p.length).toString("latin1") === p);
    if (p) {
      i += p.length;
      toks.push({ type: "punct", text: p, start, end: i, line: startLine });
      continue;
    }
    // unknown byte — skip
    i++;
  }
  void lineAt;
  return toks;
}
