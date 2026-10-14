import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instrumentJs } from "../src/js-instrument";

function run(source: string, maxEvents = "20000") {
  const dir = mkdtempSync(join(tmpdir(), "ca-js-test-"));
  try {
    const instrumented = instrumentJs(source);
    const script = join(dir, `main.${instrumented.moduleKind === "esm" ? "mjs" : "cjs"}`);
    const path = join(dir, "trace.jsonl");
    writeFileSync(script, instrumented.code);
    const stdout = execFileSync(process.execPath, [script], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      env: { ...process.env, AUTOPSY_TRACE_PATH: path, AUTOPSY_MAX_EVENTS: maxEvents },
    });
    return {
      stdout: stdout.trim(),
      events: readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe("JavaScript instrumentation semantics", () => {
  it("preserves unbraced if/else, loops, automatic semicolons, and post-increment values", () => {
    const r = run(
      "let x = 0\nif (true) x++; else x--;\nfor (let i = 0; i < 2; i++) x++;\nfor (const y of [1,2]) x += y;\nconsole.log(x)",
    );
    expect(r.stdout).toBe("6");
    expect(r.events.filter((e) => e.k === "assign" && e.n === "i").map((e) => e.v)).toEqual(["0", "1", "2"]);
  });
  it("records explicit and implicit returns inside functions, preserving strict mode", () => {
    const r = run(
      '"use strict"; function f(x){"use strict"; if(x) return; let a=2;} f(true); f(false); console.log("ok");',
    );
    expect(r.stdout).toBe("ok");
    expect(r.events.filter((e) => e.k === "returnvoid")).toHaveLength(2);
    expect(r.events.filter((e) => e.k === "call")).toHaveLength(2);
  });
  it("detects modules from syntax rather than lines and supports top-level await", () => {
    const r = run(
      '/* comment */ import fs from "node:fs"; const x = await Promise.resolve(4); console.log(x);',
    );
    expect(r.stdout).toBe("4");
    expect(instrumentJs("const x = await Promise.resolve(4);").moduleKind).toBe("esm");
  });
  it("does not collide with user names or crash when serializing circular values", () => {
    const r = run(
      "const __A=3; const __FS=4; const __autopsy_runtime=5; let a={}; a.self=a; console.log(__A+__FS+__autopsy_runtime);",
    );
    expect(r.stdout).toBe("12");
  });
  it("marks the event cap as truncation", () => {
    const r = run("let x=0; for(let i=0;i<20;i++) x++; console.log(x);", "5");
    expect(r.stdout).toBe("20");
    expect(r.events.filter((e) => e.k)).toHaveLength(5);
    expect(r.events.some((e) => e._autopsy_truncated === true)).toBe(true);
  });
  it("serializes object snapshots without invoking user getters or toJSON hooks", () => {
    const r = run(
      'let hits=0; const obj={get value(){hits++; return 5}, toJSON(){hits++; return "changed"}}; console.log(hits);',
    );
    expect(r.stdout).toBe("0");
  });
  it("preserves methods and block arrows with semicolon-free returns, and records nested mutations", () => {
    const r = run(
      "const f=(x)=>{return x+1}; const obj={f(x){return x*2}}; let tree={value:1,left:null}; tree.left={value:2}; let queue=[1]; queue.push(2); console.log(f(2)+obj.f(3));",
    );
    expect(r.stdout).toBe("9");
    expect(r.events.filter((e) => e.k === "assign" && e.n === "tree").at(-1).v).toContain('"value":2');
    expect(r.events.filter((e) => e.k === "assign" && e.n === "queue").at(-1).v).toBe("[1,2]");
    expect(r.events.filter((e) => e.k === "call")).toHaveLength(2);
  });
});
