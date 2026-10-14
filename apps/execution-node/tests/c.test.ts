import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { Problem } from "@codeautopsy/schemas";
import { processJob } from "../src/pipeline";
let gcc = false;
try {
  execFileSync(process.env.AUTOPSY_CC || "gcc", ["--version"], { stdio: "ignore", windowsHide: true });
  gcc = true;
} catch {
  /* unavailable toolchain */
}
describe.runIf(gcc)("native C", () => {
  it("accepts valid C that is not valid C++ and explains the trace limitation", async () => {
    const source =
      '#include <stdlib.h>\n#include <stdio.h>\nint main(void){int *p=malloc(sizeof(int)); *p=7; printf("%d",*p); free(p); return 0;}';
    const problem = Problem.parse({
      slug: "playground",
      title: "C run",
      difficulty: "easy",
      blurb: "",
      statement: "",
      language: "c",
      referenceSource: "",
      studentSource: "",
      tests: [{ id: "run-1", input: "", expectedOutput: "7" }],
    });
    const result = await processJob({ jobId: "native-c", problem, source, autopsy: true });
    expect(result.compileError).toBeNull();
    expect(result.verdicts[0].status).toBe("accepted");
    expect(result.language).toBe("c");
    expect(result.warnings?.join(" ")).toContain("C++-compatible");
  });
});
