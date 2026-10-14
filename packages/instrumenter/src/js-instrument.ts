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
  priority: number;
}

const MAX_PROBES = 4000;

const RUNTIME_CJS = `"__autopsy";const __FS=require("node:fs");let __BUF="",__N=0,__DIS=false;const __T0=Date.now(),__MAX=+process.env.AUTOPSY_MAX_EVENTS||200000,__TB=+process.env.AUTOPSY_TIME_BUDGET_MS||4000;let __DEP=0;
function __W(o){if(__DIS)return;if(__N>=__MAX||Date.now()-__T0>__TB){__DIS=true;return}__N++;try{__BUF+=JSON.stringify(o)+"\\n";if(__BUF.length>65536)__FL(false)}catch(e){}}
function __FL(final=false){try{if(process.env.AUTOPSY_TRACE_PATH){__FS.appendFileSync(process.env.AUTOPSY_TRACE_PATH,__BUF+(final?JSON.stringify({_autopsy_truncated:!!__DIS})+"\\n":""))}else{process.stderr.write(__BUF)}}catch(e){}__BUF=""}process.on("exit",()=>__FL(true));
function __esc(s){try{return String(s).slice(0,200)}catch(e){return "<unprintable>"}}
function __SN(v,seen=new WeakSet(),depth=0){if(v===null)return null;const t=typeof v;if(t==="bigint")return String(v);if(t==="function")return "<function>";if(t==="string")return v.slice(0,200);if(t!=="object")return v;if(depth>=6)return "<depth limit>";if(seen.has(v))return "<circular>";seen.add(v);const out=Array.isArray(v)?[]:Object.create(null);for(const key of Object.keys(v).slice(0,50)){const d=Object.getOwnPropertyDescriptor(v,key);if(d)out[key]="value" in d?__SN(d.value,seen,depth+1):"<getter>"}return out}
function __VAL(v){try{const s=JSON.stringify(__SN(v))??String(v);return s.length<=8192?s:JSON.stringify("<snapshot exceeds 8192 character limit>")}catch(e){return "<unprintable>"}}
function __A(n,l,v){__W({k:"assign",l,f:"",d:__DEP,n:__esc(n),v:__VAL(v)})}
function __AV(n,l,v){__A(n,l,v);return v}
function __B(l,c,t){__W({k:"branch",l,f:"",d:__DEP,c:__esc(c),v:"",t:!!t});return !!t}
function __S(l,c,v){__W({k:"branch",l,f:"",d:__DEP,c:__esc(c),v:__VAL(v),t:true});return v}
function __C(f,l){__DEP++;__W({k:"call",l,f:__esc(f),d:__DEP})}
function __R(f,l,v){__W({k:"return",l,f:__esc(f),d:__DEP,v:__VAL(v)});if(__DEP>0)__DEP--;return v}
function __RV(f,l){__W({k:"returnvoid",l,f:__esc(f),d:__DEP});if(__DEP>0)__DEP--}
`;

const RUNTIME_ESM = `import __FS from "node:fs";
let __BUF="",__N=0,__DIS=false;const __T0=Date.now(),__MAX=+process.env.AUTOPSY_MAX_EVENTS||200000,__TB=+process.env.AUTOPSY_TIME_BUDGET_MS||4000;let __DEP=0;
function __W(o){if(__DIS)return;if(__N>=__MAX||Date.now()-__T0>__TB){__DIS=true;return}__N++;try{__BUF+=JSON.stringify(o)+"\\n";if(__BUF.length>65536)__FL(false)}catch(e){}}
function __FL(final=false){try{if(process.env.AUTOPSY_TRACE_PATH){__FS.appendFileSync(process.env.AUTOPSY_TRACE_PATH,__BUF+(final?JSON.stringify({_autopsy_truncated:!!__DIS})+"\\n":""))}else{process.stderr.write(__BUF)}}catch(e){}__BUF=""}process.on("exit",()=>__FL(true));
function __esc(s){try{return String(s).slice(0,200)}catch(e){return "<unprintable>"}}
function __SN(v,seen=new WeakSet(),depth=0){if(v===null)return null;const t=typeof v;if(t==="bigint")return String(v);if(t==="function")return "<function>";if(t==="string")return v.slice(0,200);if(t!=="object")return v;if(depth>=6)return "<depth limit>";if(seen.has(v))return "<circular>";seen.add(v);const out=Array.isArray(v)?[]:Object.create(null);for(const key of Object.keys(v).slice(0,50)){const d=Object.getOwnPropertyDescriptor(v,key);if(d)out[key]="value" in d?__SN(d.value,seen,depth+1):"<getter>"}return out}
function __VAL(v){try{const s=JSON.stringify(__SN(v))??String(v);return s.length<=8192?s:JSON.stringify("<snapshot exceeds 8192 character limit>")}catch(e){return "<unprintable>"}}
function __A(n,l,v){__W({k:"assign",l,f:"",d:__DEP,n:__esc(n),v:__VAL(v)})}
function __AV(n,l,v){__A(n,l,v);return v}
function __B(l,c,t){__W({k:"branch",l,f:"",d:__DEP,c:__esc(c),v:"",t:!!t});return !!t}
function __S(l,c,v){__W({k:"branch",l,f:"",d:__DEP,c:__esc(c),v:__VAL(v),t:true});return v}
function __C(f,l){__DEP++;__W({k:"call",l,f:__esc(f),d:__DEP})}
function __R(f,l,v){__W({k:"return",l,f:__esc(f),d:__DEP,v:__VAL(v)});if(__DEP>0)__DEP--;return v}
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
    else if (n.type === "MemberExpression") visit(n.object);
  };
  visit(node);
  return [...new Set(out)];
}

export function instrumentJs(src: string): JsInstrumentResult {
  let ast: any;
  try {
    ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch {
    ast = acorn.parse(src, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
      locations: true,
    });
  }
  let moduleKind: "cjs" | "esm" = ast.body.some((n: any) => /^(Import|Export)/.test(n.type)) ? "esm" : "cjs";
  walk.ancestor(ast, {
    MetaProperty(node: any) {
      if (node.meta.name === "import") moduleKind = "esm";
    },
    AwaitExpression(_node: any, _state: any, ancestors: any[]) {
      if (!ancestors.some((n) => /Function/.test(n.type))) moduleKind = "esm";
    },
  });

  const insertions: Insertion[] = [];
  const ins = (pos: number, text: string, priority = 0) => {
    if (insertions.length < MAX_PROBES) insertions.push({ pos, text, priority });
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
    void node;
    void state;
    void type;
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
      else if (expr.type === "UpdateExpression" && expr.argument.type === "Identifier")
        targets = [expr.argument.name];
      else if (
        expr.type === "CallExpression" &&
        expr.callee.type === "MemberExpression" &&
        expr.callee.property.type === "Identifier" &&
        [
          "push",
          "pop",
          "shift",
          "unshift",
          "splice",
          "reverse",
          "sort",
          "fill",
          "copyWithin",
          "set",
          "add",
          "delete",
          "clear",
        ].includes(expr.callee.property.name)
      )
        targets = assignTargets(expr.callee.object);
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
      const values = [...new Set(targets)]
        .slice(0, 3)
        .map((t) => `[${JSON.stringify(t)},${t}]`)
        .join(",");
      ins(expr.start, `__UP(${node.loc.start.line},(`);
      ins(expr.end, `),${values})`);
      probes++;
    },
    VariableDeclaration(node: any, _state: any, ancestors: any[]) {
      // for-init declarations are handled by the ForStatement visitor
      if (
        ancestors.some(
          (a) =>
            (a.type === "ForStatement" && a.init === node) ||
            ((a.type === "ForOfStatement" || a.type === "ForInStatement") && a.left === node),
        )
      )
        return;
      if (node.kind !== "const" && node.kind !== "let" && node.kind !== "var") return;
      for (const d of node.declarations) {
        if (d.init && d.id.type === "Identifier") {
          ins(d.init.start, `__AV(${JSON.stringify(d.id.name)},${node.loc.start.line},(`);
          ins(d.init.end, `))`);
          probes++;
        }
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
        if (node.update.type === "UpdateExpression" && node.update.argument.type === "Identifier")
          name = node.update.argument.name;
        else if (node.update.type === "AssignmentExpression" && node.update.left.type === "Identifier")
          name = node.update.left.name;
        if (name) {
          ins(node.update.start, `__UP(${line},(`);
          ins(node.update.end, `),[${JSON.stringify(name)},${name}])`);
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
        ins(node.start, `{ __RV(${JSON.stringify(fn)},${line}); `);
        ins(node.end, ` }`);
      } else if (node.argument.type !== "ObjectExpression" && node.argument.type !== "SequenceExpression") {
        ins(node.argument.start, `__R(${JSON.stringify(fn)},${line},(`);
        ins(node.argument.end, `))`);
      } else {
        ins(node.argument.start, `__R(${JSON.stringify(fn)},${line},(`);
        ins(node.argument.end, `))`);
      }
      probes++;
    },
    FunctionDeclaration: probeFunction,
    FunctionExpression: probeFunction,
    ArrowFunctionExpression: probeFunction,
  });

  function probeFunction(node: any) {
    if (!node.body || node.body.type !== "BlockStatement") return;
    const line = node.body.loc?.start?.line ?? 0;
    const name = node.id?.name ?? "";
    const directives = node.body.body.filter((n: any) => n.directive);
    const entry = directives.length ? directives[directives.length - 1].end : node.body.start + 1;
    const params = node.params.flatMap((param: any) =>
      assignTargets(param.type === "AssignmentPattern" ? param.left : param),
    );
    ins(
      entry,
      `; __C(${JSON.stringify(name || "anonymous")},${line});${params.map((param: string) => `__A(${JSON.stringify(param)},${line},${param});`).join("")}`,
    );
    // implicit return at function end keeps depth balanced
    ins(node.body.end - 1, `; __RV(${JSON.stringify(name)},${line}); `, 1);
    probes += 2;
  }

  // Record loop bindings without inserting statements into the for (...) header.
  walk.simple(ast, {
    ForOfStatement: probeIteration,
    ForInStatement: probeIteration,
  });
  function probeIteration(node: any) {
    const target = node.left.type === "VariableDeclaration" ? node.left.declarations[0].id : node.left;
    if (target.type !== "Identifier") return;
    const probe = `__A(${JSON.stringify(target.name)},${node.loc.start.line},${target.name});`;
    if (node.body.type === "BlockStatement") ins(node.body.start + 1, probe);
    else {
      ins(node.body.start, `{${probe}`);
      ins(node.body.end, "}");
    }
    probes++;
  }

  function srcText(node: any): string {
    return src.slice(node.start, node.end);
  }

  let code = src;
  const runtime =
    (moduleKind === "esm" ? RUNTIME_ESM : RUNTIME_CJS) +
    "\nfunction __UP(l,v,...pairs){for(const [n,x] of pairs)__A(n,l,x);return v}\n";
  // Runtime bindings are private. Choose a namespace absent from the source.
  let namespace = "__autopsy_runtime";
  while (src.includes(namespace)) namespace += "_";
  for (const helper of ["A", "AV", "B", "S", "C", "R", "RV", "UP"]) {
    // Replace only injected calls; user source is never renamed.
    for (const insertion of insertions)
      insertion.text = insertion.text.replace(
        new RegExp(`\\b__${helper}\\(`, "g"),
        `${namespace}.${helper}(`,
      );
  }
  code = src;
  for (const item of [...insertions].sort((a, b) => b.pos - a.pos || b.priority - a.priority))
    code = code.slice(0, item.pos) + item.text + code.slice(item.pos);
  const fsImport = moduleKind === "esm" ? `import ${namespace}_fs from "node:fs";` : "";
  const privateRuntime =
    moduleKind === "esm"
      ? runtime.replace('import __FS from "node:fs";', `const __FS=${namespace}_fs;`)
      : runtime;
  const preamble = `${fsImport}const ${namespace}=(()=>{${privateRuntime}\nreturn {A:__A,AV:__AV,B:__B,S:__S,C:__C,R:__R,RV:__RV,UP:__UP};})();`;
  // Preserve directive prologues and hashbangs before the generated runtime.
  const directives = ast.body.filter((n: any) => n.directive);
  const prefixEnd = directives.length
    ? directives[directives.length - 1].end
    : src.startsWith("#!")
      ? src.indexOf("\n") + 1
      : 0;
  return {
    moduleKind,
    code: code.slice(0, prefixEnd) + "\n" + preamble + "\n" + code.slice(prefixEnd),
    probes: probes + 1,
  };
}
