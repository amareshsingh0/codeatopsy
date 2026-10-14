import { afterEach, describe, expect, it } from "vitest";
import { DockerSandbox } from "../src/sandbox";
let sandbox: DockerSandbox;
afterEach(() => sandbox?.cleanup());
describe.runIf(process.env.AUTOPSY_TEST_DOCKER === "true")("Docker containment integration", () => {
  it("compiles/runs native C++ with readonly execution mounts and a writable trace directory", async () => {
    sandbox = new DockerSandbox();
    const compiled = await sandbox.compile(
      "test",
      "#include <iostream>\nint main(){int x;std::cin>>x;std::cout<<x+1;}",
      [],
      "program",
    );
    expect(compiled.ok, compiled.stderr).toBe(true);
    const result = await sandbox.run("program", { input: "41", timeLimitMs: 10000, memoryLimitMb: 256 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("42");
    const readonly = await sandbox.exec(
      [
        "node",
        "-e",
        'const fs=require("fs");let blocked=false;try{fs.writeFileSync("/work/forbidden","x")}catch{blocked=true}fs.writeFileSync("/trace/test.jsonl","ok");console.log(blocked)',
      ],
      { timeoutMs: 10000 },
    );
    expect(readonly.exitCode).toBe(0);
    expect(readonly.stdout.trim()).toBe("true");
  }, 90000);
  it("runs without credentials, network interface access or root privileges and kills timed-out jobs", async () => {
    sandbox = new DockerSandbox();
    const result = await sandbox.exec(
      [
        "node",
        "-e",
        'const os=require("os");console.log(process.getuid());console.log(process.env.AUTOPSY_NODE_SECRET??"absent");console.log(Object.keys(os.networkInterfaces()).join(","))',
      ],
      { timeoutMs: 10000 },
    );
    expect(result.stdout).toContain("1000");
    expect(result.stdout).toContain("absent");
    expect(result.stdout).not.toContain("eth0");
    const timeout = await sandbox.exec(["node", "-e", "while(true){}"], { timeoutMs: 1500 });
    expect(timeout.timedOut).toBe(true);
  }, 30000);
});
