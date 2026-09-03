// 外部搜索引擎链测试：全部走注入的假 runner（不依赖机器上是否安装了
// 真实搜索二进制），覆盖探测缓存、双引擎解析、引擎失败回退纯 Node 扫描、
// 截断披露与输出形状契约。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globTool, grepTool } from "../src/search";
import {
  engineGrep,
  findEngine,
  resetEngineProbes,
  setProcessRunnerForTests,
  type EngineGrepRequest,
  type ProcessOutput,
  type ProcessRunner,
} from "../src/search-engines";
import type { ToolContext } from "@innocenceharness/harness-tools";

function fakeCtx(workspaceRoot: string, signal = new AbortController().signal): ToolContext {
  return {
    workspaceRoot,
    signal,
    log: vi.fn(),
    scope: {} as ToolContext["scope"],
  } as unknown as ToolContext;
}

function ok(stdout = "", exitCode = 0): ProcessOutput {
  return { exitCode, stdout, stderr: "", incomplete: false };
}

/** 探测默认全可用；按需覆盖各阶段的响应。 */
interface FakePlan {
  /** 单独让 rg 探测失败（退出码或 null=进程崩溃），落到下一个引擎。 */
  rgProbe?: number | null;
  /** 全部引擎探测失败（进程崩溃形态）。 */
  allProbesFail?: boolean;
  rgGrep?: () => ProcessOutput;
  ugrepGrep?: () => ProcessOutput;
  rgList?: () => ProcessOutput;
}

function planRunner(plan: FakePlan, calls: Array<{ binary: string; args: string[] }> = []): ProcessRunner {
  return (binary, args) => {
    calls.push({ binary, args });
    const isProbe = args.includes("--version");
    if (isProbe) {
      if (plan.allProbesFail) {
        return Promise.resolve({ exitCode: null, stdout: "", stderr: "", incomplete: true });
      }
      const override = binary === "rg" ? plan.rgProbe : undefined;
      return Promise.resolve(ok("", override ?? 0));
    }
    if (binary === "rg") {
      if (args[0] === "--json") return Promise.resolve(plan.rgGrep ? plan.rgGrep() : ok());
      if (args[0] === "--files") return Promise.resolve(plan.rgList ? plan.rgList() : ok());
    }
    if (binary === "ugrep" && args.includes("-r")) {
      return Promise.resolve(plan.ugrepGrep ? plan.ugrepGrep() : ok());
    }
    return Promise.resolve(ok());
  };
}

beforeEach(() => {
  resetEngineProbes();
  setProcessRunnerForTests(undefined);
});
afterEach(() => {
  setProcessRunnerForTests(undefined);
  resetEngineProbes();
});

describe("search engines: probing", () => {
  it("picks the first available engine and caches the probe", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    setProcessRunnerForTests(planRunner({}, calls));
    const first = await findEngine("grep");
    expect(first?.id).toBe("rg");
    const second = await findEngine("grep");
    expect(second?.id).toBe("rg");
    // 探测只发生一次：第二次命中缓存。
    expect(calls.filter((c) => c.args.includes("--version"))).toHaveLength(1);
  });

  it("skips engines without listing support for the list capability", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    setProcessRunnerForTests(planRunner({}, calls));
    const engine = await findEngine("list");
    expect(engine?.id).toBe("rg");
    expect(calls.some((c) => c.binary === "ugrep" && c.args.includes("--version"))).toBe(false);
  });

  it("returns undefined when every engine probe fails", async () => {
    setProcessRunnerForTests(planRunner({ allProbesFail: true }));
    expect(await findEngine("grep")).toBeUndefined();
    expect(await findEngine("list")).toBeUndefined();
  });
});

describe("search engines: grep parsing", () => {
  const req: EngineGrepRequest = { root: "/ws", pattern: "hello" };

  it("parses engine json lines and normalizes paths", async () => {
    setProcessRunnerForTests(
      planRunner({
        rgGrep: () =>
          ok(
            [
              JSON.stringify({
                type: "match",
                data: { path: { text: "src\\a.ts" }, line_number: 2, lines: { text: "hello world\n" } },
              }),
              JSON.stringify({ type: "begin", data: {} }),
              "not json",
            ].join("\n"),
          ),
      }),
    );
    const engine = (await findEngine("grep"))!;
    const result = await engineGrep(engine, req);
    expect(result.truncated).toBe(false);
    expect(result.matches).toEqual([{ file: "src/a.ts", line: 2, text: "hello world" }]);
  });

  it("parses classic grep lines with windows drive paths", async () => {
    setProcessRunnerForTests(
      planRunner({
        rgProbe: 1, // rg 不可用 → 用第二个引擎
        ugrepGrep: () => ok("D:\\ws\\src\\b.ts:12:hello again\n"),
      }),
    );
    const engine = (await findEngine("grep"))!;
    expect(engine.id).toBe("ugrep");
    const result = await engineGrep(engine, req);
    expect(result.matches).toEqual([{ file: "D:/ws/src/b.ts", line: 12, text: "hello again" }]);
  });

  it("treats exit 1 as no matches instead of a failure", async () => {
    setProcessRunnerForTests(planRunner({ rgGrep: () => ok("", 1) }));
    const engine = (await findEngine("grep"))!;
    const none = await engineGrep(engine, req);
    expect(none).toEqual({ matches: [], truncated: false });
  });

  it("discloses truncation when the process was cut short", async () => {
    setProcessRunnerForTests(
      planRunner({
        rgGrep: () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            type: "match",
            data: { path: { text: "a.md" }, line_number: 1, lines: { text: "hi" } },
          }),
          stderr: "",
          incomplete: true,
        }),
      }),
    );
    const engine = (await findEngine("grep"))!;
    const result = await engineGrep(engine, req);
    expect(result.truncated).toBe(true);
  });

  it("throws for an engine-level failure without matches (caller falls back)", async () => {
    setProcessRunnerForTests(
      planRunner({ rgGrep: () => ({ exitCode: 2, stdout: "", stderr: "boom", incomplete: false }) }),
    );
    const engine = (await findEngine("grep"))!;
    await expect(engineGrep(engine, req)).rejects.toThrow("boom");
  });

  it("returns partial matches with truncation on engine error after output", async () => {
    setProcessRunnerForTests(
      planRunner({
        rgGrep: () => ({
          exitCode: 2,
          stdout: JSON.stringify({
            type: "match",
            data: { path: { text: "a.md" }, line_number: 3, lines: { text: "partial" } },
          }),
          stderr: "some files unreadable",
          incomplete: false,
        }),
      }),
    );
    const engine = (await findEngine("grep"))!;
    const result = await engineGrep(engine, req);
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(1);
  });
});

describe("grep tool: engine path and node fallback", () => {
  let ws = "";
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "innocence-grep-"));
    fs.writeFileSync(path.join(ws, "a.ts"), "const alpha = 1;\nconst beta = 2;\n");
    fs.mkdirSync(path.join(ws, "sub"));
    fs.writeFileSync(path.join(ws, "sub", "b.md"), "alpha in markdown\n");
  });
  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("formats engine matches into the shared `file:line: text` shape", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    setProcessRunnerForTests(
      planRunner({
        rgGrep: () =>
          ok(
            JSON.stringify({
              type: "match",
              data: { path: { text: "a.ts" }, line_number: 1, lines: { text: "const alpha = 1;\n" } },
            }),
          ),
      }, calls),
    );
    const result = await grepTool.execute({ pattern: "alpha" }, fakeCtx(ws));
    expect(result.content).toBe("a.ts:1: const alpha = 1;");
    expect(calls[0].binary).toBe("rg");
    // 子进程以工作区根为 cwd、模式与目录作为参数传递。
    const grepCall = calls.find((c) => c.args.includes("--json"))!;
    expect(grepCall.args).toContain("alpha");
    expect(grepCall.args[grepCall.args.length - 1]).toBe(".");
  });

  it("falls back to the node scan when no engine is available", async () => {
    setProcessRunnerForTests(planRunner({ allProbesFail: true }));
    const result = await grepTool.execute({ pattern: "alpha" }, fakeCtx(ws));
    expect(result.content).toContain("a.ts:1: const alpha = 1;");
    expect(result.content).toContain("sub/b.md:1: alpha in markdown");
  });

  it("falls back when the engine fails and logs the reason", async () => {
    setProcessRunnerForTests(planRunner({ rgGrep: () => ({ exitCode: 2, stdout: "", stderr: "exploded", incomplete: false }) }));
    const ctx = fakeCtx(ws);
    const result = await grepTool.execute({ pattern: "alpha" }, ctx);
    expect(result.content).toContain("a.ts:1: const alpha = 1;");
    expect(ctx.log).toHaveBeenCalledWith("warn", "search engine failed; falling back to node scan", expect.anything());
  });

  it("passes glob filter and subDir through to the engine", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    setProcessRunnerForTests(planRunner({ rgGrep: () => ok() }, calls));
    await grepTool.execute({ pattern: "alpha", glob: "*.ts", path: "sub" }, fakeCtx(ws));
    const grepCall = calls.find((c) => c.args.includes("--json"))!;
    expect(grepCall.args.includes("--glob")).toBe(true);
    expect(grepCall.args[grepCall.args.length - 1]).toBe("sub");
  });
});

describe("glob tool: engine path and node fallback", () => {
  let ws = "";
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "innocence-glob-"));
    fs.writeFileSync(path.join(ws, "a.ts"), "x\n");
    fs.writeFileSync(path.join(ws, "b.md"), "x\n");
    fs.mkdirSync(path.join(ws, "sub"));
    fs.writeFileSync(path.join(ws, "sub", "c.ts"), "x\n");
  });
  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("filters engine file listings by glob and normalizes separators", async () => {
    setProcessRunnerForTests(
      planRunner({
        rgList: () => ok("a.ts\nb.md\nsub\\c.ts\n"),
      }),
    );
    const result = await globTool.execute({ pattern: "**/*.ts" }, fakeCtx(ws));
    expect(result.content.split("\n")).toEqual(["a.ts", "sub/c.ts"]);
  });

  it("falls back to the node walk when no engine is available", async () => {
    setProcessRunnerForTests(planRunner({ allProbesFail: true }));
    const result = await globTool.execute({ pattern: "**/*.md" }, fakeCtx(ws));
    expect(result.content).toBe("b.md");
  });
});
