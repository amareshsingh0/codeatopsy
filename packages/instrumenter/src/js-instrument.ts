/**
 * JavaScript source-to-source instrumenter (acorn AST based).
 *
 * Injects __A/__AV/__B/__S/__C/__R/__RV probe calls — the JS equivalents of the
 * C++ AUTOPSY_* probes — plus a self-contained JSONL runtime preamble, so the
 * traced file runs with plain `node` and emits the same TraceEvent stream.
 */
import * as acorn from "acorn";
import * as walk from "acorn-walk";

export interface JsInstrumentResult {
  /** "cjs" or "esm" — detected from import/export usage */
  moduleKind: "cjs" | "esm";
  code: string;
  probes: number;
}

interface Insertion {
  pos: number;
  text: string;
}

const MAX_PROBES = 4000;

const RUNTIME_CJS = `"__autopsy";const __FS=require("node:fs");let __BUF="",__N=0,__DIS=false;const __T0=Date.now(),__MAX=+process.env.AUTOPSY_MAX_EVENTS||200000,__TB=+process.env.AUTOPSY_TIME_BUDGET_MS||4000;let __DEP=0;
function __W(o){if(__DIS||__N>=__MAX){return}if(++__N%1024===0&&Date.now()-__T0>__TB){__DIS=true}try{__BUF+=JSON.stringify(o)+"\\n"}catch(e){}}
function __FL(){try{if(process.env.AUTOPSY_TRACE_PATH){__FS.appendFileSync(process.env.AUTOPSY_TRACE_PATH,__BUF+"{\\"_autopsy_truncated\\":"+(!!__DIS)+"}\\n")}else{process.stderr.write(__BUF)}}catch(e){}}process.on("exit",__FL);
function __esc(s){return s==null?"":String(s)}
function __A(n,l,v){__W({k:"assign",l,f:"",d:__DEP,n:__esc(n),v:__esc(typeof v==="object"?JSON.stringify(v):v)})}
function __AV(n,l,v){__A(n,l,v);return v}
function __B(l,c,t){__W({k:"branch",l,f:"",d:__DEP,c:__esc(c),v:"",t:!!t});return !!t}
function __S(l,c,v){__W({k:"branch",l,f:"",d:__DEP,c:__esc(c),v:__esc(typeof v==="object"?JSON.stringify(v):v),t:true});return v}
function __C(f,l){__DEP++;__W({k:"call",l,f:__esc(f),d:__DEP})}
function __R(f,l,v){__W({k:"return",l,f:__esc(f),d:__DEP,v:__esc(typeof v==="object"?JSON.stringify(v):v)});if(__DEP>0)__DEP--;return v}
function __RV(f,l){__W({k:"returnvoid",l,f:__esc(f),d:__DEP});if(__DEP>0)__DEP--}
`;

const RUNTIME_ESM = `import __FS from "node:fs";
let __BUF="",__N=0,__DIS=false;const __T0=Date.now(),__MAX=+process.env.AUTOPSY_MAX_EVENTS||200000,__TB=+process.env.AUTOPSY_TIME_BUDGET_MS||4000;let __DEP=0;
function __W(o){if(__DIS||__N>=__MAX){return}if(++__N%1024===0&&Date.now()-__T0>__TB){__DIS=true}try{__BUF+=JSON.stringify(o)+"\\n"}catch(e){}}
function __FL(){try{if(process.env.AUTOPSY_TRACE_PATH){__FS.appendFileSync(process.env.AUTOPSY_TRACE_PATH,__BUF+"{\\"_autopsy_truncated\\":"+(!!__DIS)+"}\\n")}else{process.stderr.write(__BUF)}}catch(e){}}process.on("exit",__FL);
function __esc(s){return s==null?"":String(s)}
function __A(n,l,v){__W({k:"assign",l,f:"",d:__DEP,n:__esc(n),v:__esc(typeof v==="object"?JSON.stringify(v):v)})}
function __AV(n,l,v){__A(n,l,v);return v}
function __B(l,c,t){__W({k:"branch",l,f:"",d:__DEP,c:__esc(c),v:"",t:!!t});return !!t}
function __S(l,c,v){__W({k:"branch",l,f:"",d:__DEP,c:__esc(c),v:__esc(typeof v==="object"?JSON.stringify(v):v),t:true});return v}
function __C(f,l){__DEP++;__W({k:"call",l,f:__esc(f),d:__DEP})}
function __R(f,l,v){__W({k:"return",l,f:__esc(f),d:__DEP,v:__esc(typeof v==="object"?JSON.stringify(v):v)});if(__DEP>0)__DEP--;return v}
function __RV(f,l){__W({k:"returnvoid",l,f:__esc(f),d:__DEP});if(__DEP>0)__DEP--}
`;

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").slice(0, 160);
}

/** identifier targets of an assignment/update, skipping member properties */
function assignTargets(node: any): string[] {
  const out: string[] = [];
  const visit = (n: any) => {
    if (!n) return;
    if (n.type === "Identifier") out.push(n.name);
    else if (n.type === "ParenthesizedExpression") visit(n.expression);
    else if (n.type === "ArrayPattern") n.elements.forEach((e: any) => e && visit(e));
    else if (n.type === "ObjectPattern") n.properties.forEach((p: any) => visit(p.value ?? p.argument));
    // MemberExpression / others intentionally skipped
  };
  visit(node);
  return [...new Set(out)];
}

export function instrumentJs(src: string): JsInstrumentResult {
  const moduleKind: "cjs" | "esm" = /(^|\n)\s*(import\s|export\s)/.test(src) ? "esm" : "cjs";
  let ast: any;
  try {
    ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch {
    ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, locations: true });
  }

  const insertions: Insertion[] = [];
  const ins = (pos: number, text: string) => {
    if (insertions.length < MAX_PROBES) insertions.push({ pos, text });
  };
  let probes = 0;

  // current enclosing function name (best effort): map node -> name
  const fnName = new Map<any, string>();
  (function index(node: any, parent: any) {
    if (!node) return;
    if (node.type === "FunctionDeclaration" && node.id) {
      fnName.set(node, node.id.name);
      fnName.set(node.body, node.id.name);
    }
  })(ast, null);
  // build parent map for name lookup
  const parents = new Map<any, any>();
  walk.full(ast, (node: any, state: any, type: string) => {
    // walk.full doesn't give parent directly; build via simple recursive walk instead
    void node; void state; void type;
  });
  const buildParents = (node: any, parent: any) => {
    if (!node || typeof node !== "object") return;
    parents.set(node, parent);
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = (node as any)[key];
      if (Array.isArray(v)) v.forEach((c) => buildParents(c, node));
      else if (v && typeof v === "object" && typeof v.type === "string") buildParents(v, node);
    }
  };
  buildParents(ast, null);
  const enclosingFn = (node: any): string => {
    let p = parents.get(node);
    while (p) {
      if (p.type === "FunctionDeclaration" && p.id) return p.id.name;
      p = parents.get(p);
    }
    return "";
  };

  const inModuleScope = (node: any): boolean => {
    // don't probe at module top level? We DO want top-level tracing; everything allowed.
    void node;
    return true;
  };

  walk.ancestor(ast, {
    ExpressionStatement(node: any) {
      const expr = node.expression;
      let targets: string[] | null = null;
      if (expr.type === "AssignmentExpression") targets = assignTargets(expr.left);
      else if (expr.type === "UpdateExpression" && expr.argument.type === "Identifier") targets = [expr.argument.name];
      if (!targets || targets.length === 0) return;
      if (expr.type === "AssignmentExpression" && expr.operator === "=") {
        // also handles chained `a = b = 1` — inner one is its own ExpressionStatement? no, nested.
        // handle nested assignments in the right side
        const nested: string[] = [];
        walk.full(expr.right, (n: any) => {
          if (n.type === "AssignmentExpression") nested.push(...assignTargets(n.left));
        });
        targets = [...targets, ...nested];
      }
      for (const t of targets.slice(0, 3)) {
        ins(node.end, ` __A(${JSON.stringify(t)},${node.loc?.start?.line ?? 0},${t});`);
        probes++;
      }
    },
    VariableDeclaration(node: any, _state: any, ancestors: any[]) {
      // for-init declarations are handled by the ForStatement visitor
      if (ancestors.some((a) => a.type === "ForStatement" && a.init === node)) return;
      if (node.kind !== "const" && node.kind !== "let" && node.kind !== "var") return;
      const names: string[] = [];
      for (const d of node.declarations) {
        if (d.init && d.id.type === "Identifier") names.push(d.id.name);
        else if (d.init && d.id.type === "ObjectPattern") {
          for (const p of d.id.properties) if (p.value?.type === "Identifier") names.push(p.value.name);
        } else if (d.init && d.id.type === "ArrayPattern") {
          for (const el of d.id.elements) if (el?.type === "Identifier") names.push(el.name);
        }
      }
      const line = node.loc?.start?.line ?? 0;
      for (const n of names.slice(0, 4)) {
        ins(node.end, ` __A(${JSON.stringify(n)},${line},${n});`);
        probes++;
      }
    },
    IfStatement(node: any) {
      if (node.test.type === "SequenceExpression") return; // rare; skip to stay safe
      const line = node.loc?.start?.line ?? 0;
      const src = srcText(node.test);
      ins(node.test.start, `__B(${line},${JSON.stringify(esc(src))},(`);
      ins(node.test.end, `))`);
      probes++;
    },
    WhileStatement(node: any) {
      const line = node.loc?.start?.line ?? 0;
      const src = srcText(node.test);
      ins(node.test.start, `__B(${line},${JSON.stringify(esc(src))},(`);
      ins(node.test.end, `))`);
      probes++;
    },
    DoWhileStatement(node: any) {
      const line = node.loc?.start?.line ?? 0;
      const src = srcText(node.test);
      ins(node.test.start, `__B(${line},${JSON.stringify(esc(src))},(`);
      ins(node.test.end, `))`);
      probes++;
    },
    ForStatement(node: any) {
      const line = node.loc?.start?.line ?? 0;
      if (node.test && node.test.type !== "SequenceExpression") {
        const src = srcText(node.test);
        ins(node.test.start, `__B(${line},${JSON.stringify(esc(src))},(`);
        ins(node.test.end, `))`);
        probes++;
      }
      // init `let i = 0` / `i = 0`
      if (node.init) {
        if (node.init.type === "VariableDeclaration" && node.init.declarations.length === 1) {
          const d = node.init.declarations[0];
          if (d.init && d.id.type === "Identifier") {
            ins(d.init.start, `__AV(${JSON.stringify(d.id.name)},${line},(`);
            ins(d.init.end, `))`);
            probes++;
          }
        } else if (node.init.type === "AssignmentExpression" && node.init.left.type === "Identifier") {
          ins(node.init.start, `__AV(${JSON.stringify(node.init.left.name)},${line},(`);
          ins(node.init.end, `))`);
          probes++;
        }
      }
      // update `i++` / `i += 2` / `i = i + 1`
      if (node.update) {
        let name: string | null = null;
        if (node.update.type === "UpdateExpression" && node.update.argument.type === "Identifier") name = node.update.argument.name;
        else if (node.update.type === "AssignmentExpression" && node.update.left.type === "Identifier") name = node.update.left.name;
        if (name) {
          ins(node.update.start, `__AV(${JSON.stringify(name)},${line},(`);
          ins(node.update.end, `))`);
          probes++;
        }
      }
    },
    SwitchStatement(node: any) {
      const line = node.loc?.start?.line ?? 0;
      const src = srcText(node.discriminant);
      ins(node.discriminant.start, `__S(${line},${JSON.stringify(esc(src))},(`);
      ins(node.discriminant.end, `))`);
      probes++;
    },
    ReturnStatement(node: any) {
      const fn = enclosingFn(node);
      const line = node.loc?.start?.line ?? 0;
      if (!node.argument) {
        ins(node.end, ` __RV(${JSON.stringify(fn)},${line}); `);
      } else if (node.argument.type !== "ObjectExpression" && node.argument.type !== "SequenceExpression") {
        ins(node.argument.start, `__R(${JSON.stringify(fn)},${line},(`);
        ins(node.argument.end, `))`);
      } else {
        ins(node.argument.start, `__R(${JSON.stringify(fn)},${line},(`);
        ins(node.argument.end, `))`);
      }
      probes++;
    },
    FunctionDeclaration(node: any) {
      if (!node.body || node.body.type !== "BlockStatement") return;
      const line = node.body.loc?.start?.line ?? 0;
      const name = node.id?.name ?? "";
      ins(node.body.start + 1, ` __C(${JSON.stringify(name)},${line});`);
      // implicit return at function end keeps depth balanced
      ins(node.body.end, ` __RV(${JSON.stringify(name)},${line}); `);
      probes += 2;
    },
  });

  function srcText(node: any): string {
    return src.slice(node.start, node.end);
  }

  // apply insertions (string indices — sort desc)
  let code = src;
  const sorted = [...insertions].sort((a, b) => b.pos - a.pos);
  for (const item of sorted) {
    code = code.slice(0, item.pos) + item.text + code.slice(item.pos);
  }
  const preamble = moduleKind === "esm" ? RUNTIME_ESM : RUNTIME_CJS;
  return { moduleKind, code: preamble + "\n" + code, probes: probes + 1 };
}
