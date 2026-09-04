// fs 工厂搜索配置测试：enhancedFindGrep（searchEngine）：
// "builtin" = 内置 Node 扫描（从不探测
//     外部引擎）；"auto" = 探测外部引擎（注入假 runner 验证）。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { createExecutionScope, type ToolContext } from "@innocenceharness/harness-tools";
import { createGlobTool, createGrepTool } from "../src/search";
import { createFsPlugin } from "../src/index";
import {
  resetEngineProbes,
  setProcessRunnerForTests,
  type ProcessRunner,
} from "../src/search-engines";

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-fsfactory-"));
  await fs.writeFile(path.join(root, "hello.txt"), "hello needle world\nsecond line\n", "utf8");
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

afterEach(() => {
  setProcessRunnerForTests(undefined);
  resetEngineProbes();
});

const ctx = (toolName = "Write"): ToolContext => ({
  workspaceRoot: root,
  signal: new AbortController().signal,
  log: () => {},
  scope: createExecutionScope(toolName),
});

describe("searchEngine (enhancedFindGrep 设置)", () => {
  it("builtin mode never invokes the engine probe and greps via the Node scan", async () => {
    const runner = vi.fn<ProcessRunner>(() => Promise.reject(new Error("must not spawn")));
    setProcessRunnerForTests(runner);

    const grep = createGrepTool({ searchEngine: "builtin" });
    const result = await grep.execute({ pattern: "needle" }, ctx("Grep"));
    expect(result.content).toContain("hello.txt:1: hello needle world");

    const glob = createGlobTool({ searchEngine: "builtin" });
    const listed = await glob.execute({ pattern: "*.txt" }, ctx("Glob"));
    expect(listed.content).toContain("hello.txt");

    expect(runner).not.toHaveBeenCalled();
  });

  it("auto mode (default) probes and uses an available engine", async () => {
    const runner = vi.fn<ProcessRunner>((_binary, args) => {
      if (args.includes("--version")) {
        return Promise.resolve({ exitCode: 0, stdout: "ripgrep 14", stderr: "", incomplete: false });
      }
      return Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({
          type: "match",
          data: {
            path: { text: "hello.txt" },
            line_number: 1,
            lines: { text: "hello needle world\n" },
          },
        }) + "\n",
        stderr: "",
        incomplete: false,
      });
    });
    setProcessRunnerForTests(runner);

    const grep = createGrepTool(); // zero-config = auto
    const result = await grep.execute({ pattern: "needle" }, ctx("Grep"));
    expect(result.content).toContain("hello.txt:1: hello needle world");
    expect(runner).toHaveBeenCalled();
  });

  it("the plugin factory carries the engine mode into the mounted tools", async () => {
    const runner = vi.fn<ProcessRunner>(() => Promise.reject(new Error("must not spawn")));
    setProcessRunnerForTests(runner);
    const kernel = new Context();
    await kernel.plugin(ToolsPlugin);
    await kernel.plugin(createFsPlugin({ searchEngine: "builtin" }));

    const result = await kernel.tools.get("Grep")!.execute({ pattern: "needle" }, ctx("Grep"));
    expect(result.content).toContain("hello.txt:1: hello needle world");
    expect(runner).not.toHaveBeenCalled();
  });
});
