import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instrument } from "../src/instrument";
import { runtimeHeaderPath } from "../src/runtime-header";

function hasGxx(): boolean {
  try {
    execFileSync("g++", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const STUDENT = `#include <bits/stdc++.h>
using namespace std;

int binarySearch(const vector<int>& a, int target) {
    int left = 0;
    int right = (int)a.size() - 1;

    while (left < right) {
        int mid = left + (right - left) / 2;

        if (a[mid] == target)
            return mid;

        if (a[mid] < target)
            left = mid + 1;
        else
            right = mid - 1;
    }

    return -1;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    if (!(cin >> n)) return 0;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    int target;
    cin >> target;

    cout << binarySearch(a, target) << "\\n";
    return 0;
}
`;

describe("instrumenter — unit", () => {
  it("injects probes without changing program semantics", () => {
    const r = instrument(STUDENT);
    expect(r.probes).toBeGreaterThan(10);
    expect(r.code).toContain('AUTOPSY_BRANCH("left < right"');
    expect(r.code).toContain('AUTOPSY_ASSIGN("left"');
    expect(r.code).toContain('AUTOPSY_CALL("binarySearch"');
    expect(r.code).toContain('AUTOPSY_RETURN("binarySearch"');
    // while-loop counter in main's for gets instrumented
    expect(r.code).toContain('AUTOPSY_ASSIGNV("i"');
  });

  it("wraps each condition exactly once (no double evaluation)", () => {
    const src = `int main() {
  int x = 0;
  while (x < 3)
    x = x + 1;
  if (x == 3) { x = x * 2; }
  switch (x) { case 6: break; }
  return x;
}`;
    const r = instrument(src);
    expect(r.code.match(/AUTOPSY_BRANCH\(/g)!.length).toBe(2); // while + if
    expect(r.code.match(/AUTOPSY_SWITCH\(/g)!.length).toBe(1);
    expect(r.code).toContain("static_cast<bool>(x < 3)");
  });

  it("skips declaration conditions and range-for", () => {
    const src = `#include <cstdio>
int main() {
  int arr[3] = {1, 2, 3};
  for (int x : arr) { (void)x; }
  if (int c = 5) { (void)c; }
  return 0;
}`;
    const r = instrument(src);
    expect(r.code).not.toContain("AUTOPSY_BRANCH");
    expect(r.notes.length).toBeGreaterThanOrEqual(2);
  });

  it("never injects inside struct bodies", () => {
    const src = `struct Node {
  int val = 0;
  Node* next = nullptr;
};
int main() {
  Node n;
  n.val = 7;
  return n.val;
}`;
    const r = instrument(src);
    expect(r.code).not.toContain('AUTOPSY_ASSIGN("val"');
    expect(r.code).not.toContain('AUTOPSY_ASSIGN("next"');
  });

  it("handles cin input probing", () => {
    const src = `#include <iostream>
int main() {
  int n, t;
  std::cin >> n >> t;
  std::cout << n + t << "\\n";
  return 0;
}`;
    const r = instrument(src);
    expect(r.code).toContain('AUTOPSY_ASSIGN("n", 4, n)');
    expect(r.code).toContain('AUTOPSY_ASSIGN("t", 4, t)');
  });
});

describe.skipIf(!hasGxx())("instrumenter — end-to-end compile+run", () => {
  it("produces a valid JSONL trace for the buggy binary search", () => {
    const dir = mkdtempSync(join(tmpdir(), "autopsy-"));
    try {
      const { code } = instrument(STUDENT);
      const cpp = join(dir, "student.cpp");
      const exe = join(dir, "student.exe");
      const trace = join(dir, "trace.jsonl");
      writeFileSync(cpp, code);
      execFileSync(
        "g++",
        ["-std=c++17", "-O0", "-include", runtimeHeaderPath, "-o", exe, cpp],
        { stdio: ["ignore", "pipe", "pipe"], timeout: 60000 },
      );
      const out = execFileSync(exe, {
        input: "7\n2 4 7 9 11 15 18\n18\n",
        timeout: 15000,
        env: { ...process.env, AUTOPSY_TRACE_PATH: trace, AUTOPSY_TIME_BUDGET_MS: "3000" },
      }).toString();
      expect(out.trim()).toBe("-1"); // the bug reproduces

      const raw = readFileSync(trace, "utf8");
      const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
      const trailer = lines.filter((l) => "_autopsy_truncated" in l);
      const events = lines.filter((l) => "k" in l);
      expect(trailer).toHaveLength(1);
      expect(events.length).toBeGreaterThan(15);
      const branch = events.find((e) => e.k === "branch" && e.c === "left < right");
      expect(branch).toBeTruthy();
      expect(branch.t).toBe(true);
      const assigns = events.filter((e) => e.k === "assign" && e.n === "left");
      expect(assigns.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
