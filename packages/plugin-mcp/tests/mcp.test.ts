import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@innocenceharness/kernel";
import { LoggerPlugin } from "@innocenceharness/kernel-logger";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { createExecutionScope, type ToolContext } from "@innocenceharness/harness-tools";
import { createSessionPlugin, textMessage } from "@innocenceharness/harness-session";
import { StdioJsonRpcClient, createMcpPlugin, type StdioServerOptions } from "../src";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "echo-server.mjs",
);

/** Mounts the plugin on a bare kernel context (logger + tools + session
 *  spines); the plugin fiber's unwind (ctx.fiber.dispose) replaces the old
 *  registry dispose. */
async function mountMcp(servers: Record<string, StdioServerOptions>): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(LoggerPlugin);
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(
    createSessionPlugin({
      provider: { id: "bare", async *chat(): AsyncIterable<never> {} },
      sessionId: "sess-bare",
    }),
  );
  await ctx.plugin(createMcpPlugin({ servers }));
  return ctx;
}

/** Polls process.kill(pid, 0) until every pid is gone (process tree exited). */
async function waitGone(pids: number[], timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const alive = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (alive.length === 0) return;
    if (Date.now() > deadline) throw new Error(`进程仍然存活: ${alive.join(", ")}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

let client: StdioJsonRpcClient;
beforeAll(async () => {
  client = new StdioJsonRpcClient({ command: process.execPath, args: [fixture] });
  await client.start();
});
afterAll(async () => {
  await client.dispose();
});

const ctxToolContext = (signal?: AbortSignal): ToolContext => ({
  workspaceRoot: "D:/tmp",
  signal: signal ?? new AbortController().signal,
  log: () => {},
  scope: createExecutionScope("mcp__echo__echo"),
});

describe("StdioJsonRpcClient", () => {
  it("round-trips requests against the fixture server", async () => {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "InnocenceHarness", version: "0" },
    });
    expect((init as { serverInfo?: { name?: string } }).serverInfo?.name).toBe(
      "echo-fixture",
    );
    const list = await client.request<{ tools?: Array<{ name: string }> }>("tools/list", {});
    expect(list.tools?.[0]?.name).toBe("echo");
    const call = await client.request<{ content?: Array<{ text?: string }> }>("tools/call", {
      name: "echo",
      arguments: { text: "你好" },
    });
    expect(call.content?.[0]?.text).toBe("echo: 你好");
  });

  it("rejects with the server's error message", async () => {
    await expect(client.request("nope")).rejects.toThrow("unknown: nope");
  });
});

describe("StdioJsonRpcClient dispose", () => {
  it("ends the server gracefully (no grace expiry) and is idempotent", async () => {
    const c = new StdioJsonRpcClient({ command: process.execPath, args: [fixture] });
    await c.start();
    const pid = c.pid;
    expect(pid).toBeGreaterThan(0);

    const started = Date.now();
    await c.dispose();
    const elapsed = Date.now() - started;
    // The plain fixture exits on stdin EOF, so dispose resolves within the
    // DISPOSE_GRACE_MS window (<2s) — the force-kill branch can only fire
    // AFTER the full grace elapses, so this bounds the graceful path.
    expect(elapsed).toBeLessThan(2_000);

    await expect(c.dispose()).resolves.toBeUndefined(); // idempotent — no throw
    await waitGone([pid!]);
    expect(c.isExited).toBe(true);
  });

  it("fails fast when a request arrives after dispose", async () => {
    const c = new StdioJsonRpcClient({ command: process.execPath, args: [fixture] });
    await c.start();
    await c.dispose();
    await expect(c.request("tools/list", {})).rejects.toThrow("MCP 客户端已释放");
  });

  it("force-kills the process tree when the server ignores stdin close", async () => {
    const c = new StdioJsonRpcClient({
      command: process.execPath,
      args: [fixture],
      env: { MCP_FIXTURE_HOLD: "1" },
    });
    await c.start();
    const pid = c.pid!;
    await c.dispose();
    // MCP_FIXTURE_HOLD keeps the server alive past stdin close: only the
    // taskkill /T /F (or POSIX group kill) branch can end it.
    await waitGone([pid]);
  }, 15_000);
});

describe("request abort signal", () => {
  it("sanitizes untrusted server error text (control chars + hard truncation)", async () => {
    const c = new StdioJsonRpcClient({ command: process.execPath, args: [fixture] });
    await c.start();
    const SECRET = `MCP-BOOM-SECRET-${"x".repeat(600)}`;
    const err = await c
      .request("tools/call", { name: "boom", arguments: { token: SECRET } })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    // The echoed secret never survives in full and the text is bounded.
    expect(message).not.toContain(SECRET);
    expect(message).toContain("[已截断");
    expect(message.length).toBeLessThanOrEqual(600);
    // Control characters from the hostile payload are stripped.
    expect(/[\u0000-\u001f\u007f]/.test(message)).toBe(false);
    await c.dispose();
  });

  it("aborts an in-flight request and notifies the server (notifications/cancelled)", async () => {
    const c = new StdioJsonRpcClient({ command: process.execPath, args: [fixture] });
    await c.start();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    await expect(
      c.request("tools/call", { name: "slow", arguments: {} }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(5_000);

    const log = await c.request<{ content?: Array<{ text?: string }> }>("tools/call", {
      name: "cancel_log",
      arguments: {},
    });
    // The fixture recorded the cancelled request id (a positive number).
    const recorded = JSON.parse(log.content?.[0]?.text ?? "[]") as unknown[];
    expect(recorded.length).toBeGreaterThanOrEqual(1);
    expect(recorded[0]).toEqual(expect.any(Number));
    expect(Date.now() - started).toBeLessThan(5_000);
    await c.dispose();
  });

  it("MCP tool execute rejects with an AbortError when ctx.signal aborts", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    const tool = ctx.tools.get("mcp__echo__slow")!;
    const controller = new AbortController();
    const promise = tool.execute({ text: "x" }, ctxToolContext(controller.signal));
    setTimeout(() => controller.abort(), 100);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await ctx.fiber.dispose();
  });

  it("server-echoed secrets are truncated out of isError tool results", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    const tool = ctx.tools.get("mcp__echo__boom")!;
    const SECRET = `MCP-BOOM-SECRET-${"y".repeat(600)}`;
    // The isError result is what history/audit persist — the echoed secret
    // must not survive intact past the client's trust boundary.
    const result = await tool.execute({ token: SECRET }, ctxToolContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("MCP 调用失败");
    expect(result.content).not.toContain(SECRET);
    expect(result.content).toContain("[已截断");
    await ctx.fiber.dispose();
  });
});

describe("createMcpPlugin", () => {
  it("maps server tools as mcp__server__tool and executes calls end-to-end", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    const tool = ctx.tools.get("mcp__echo__echo");
    expect(tool).toBeDefined();
    expect(tool!.readOnly).toBe(false);
    expect(tool!.sideEffect).toBe("unknown"); // 外部服务器能力未知，按最保守处理
    const result = await tool!.execute({ text: "hello" }, ctxToolContext());
    expect(result.content).toBe("echo: hello");
    expect(result.isError).toBeFalsy();
    await ctx.fiber.dispose();
  });

  it("persists server/tool and the full argument text", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    const tool = ctx.tools.get("mcp__echo__echo")!;
    const SECRET = "MCP-PLUGIN-SECRET-77aa1";
    const resource = tool.permissionResource({ text: SECRET }, ctxToolContext());
    expect(resource).toEqual({ action: "call", kind: "mcp", scope: "echo/echo" });

    // 完整参数原文持久化：展示与留档直接读 persisted.args。
    const persisted = tool.persistArgs({ text: SECRET, extra: 1 });
    expect(persisted).toEqual({
      server: "echo",
      tool: "echo",
      args: { text: SECRET, extra: 1 },
    });
    expect(JSON.stringify(persisted)).toContain(SECRET);
    await ctx.fiber.dispose();
  });

  it("skips unreachable servers without failing activation", async () => {
    const ctx = await mountMcp({
      missing: { command: "definitely-not-a-real-command-xyz", args: [] },
    });
    // kernel still usable, no tools from the missing server
    expect(ctx.tools.specs().map((s) => s.name).filter((k) => k.startsWith("mcp__"))).toEqual([]);
    await ctx.fiber.dispose();
  });

  it("dispose releases every stdio server's whole process tree", async () => {
    // HOLD servers ignore stdin close, so disposal must take the force-kill
    // tree branch (Windows taskkill /T /F, POSIX process-group kill).
    const server = (): StdioServerOptions => ({
      command: process.execPath,
      args: [fixture],
      env: { MCP_FIXTURE_HOLD: "1" },
    });
    const ctx = await mountMcp({ echo: server(), second: server() });

    const pids: number[] = [];
    for (const name of ["echo", "second"]) {
      const result = await ctx.tools.get(`mcp__${name}__tree`)!.execute({}, ctxToolContext());
      const match = result.content.match(/parent=(\d+) child=(\d+)/);
      expect(match).toBeDefined();
      pids.push(Number(match![1]), Number(match![2]));
    }
    expect(pids.length).toBe(4);

    await ctx.fiber.dispose();
    await waitGone(pids); // both servers AND their spawned children are gone
  }, 25_000);
});

describe("failed-connection note", () => {
  it("appends a first-turn note listing failed servers with reasons", async () => {
    const ctx = await mountMcp({
      missing: { command: "definitely-not-a-real-command-xyz", args: [] },
    });
    const processor = ctx.session.processors().find((p) => p.name === "mcp-connection-status");
    expect(processor).toBeDefined();
    const first = await ctx.session.processUserInput(textMessage("user", "hello"));
    const firstText = first.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    expect(firstText).toContain("hello"); // 原文不改写，仅追加
    expect(firstText).toMatch(/<system-reminder>/);
    expect(firstText).toContain("missing");
    expect(firstText).toMatch(/connection|connect/i);
    // 英文注记、无第三方名
    const note = firstText.slice(firstText.indexOf("<system-reminder>"));
    expect(note).not.toMatch(/[\u4e00-\u9fff]/);
    for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
      expect(note).not.toMatch(re);
    }
    const second = await ctx.session.processUserInput(textMessage("user", "again"));
    const secondText = second.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    expect(secondText).not.toMatch(/<system-reminder>/); // 首轮一次
    await ctx.fiber.dispose();
  });

  it("registers no note processor when every server connected", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    expect(
      ctx.session.processors().find((p) => p.name === "mcp-connection-status"),
    ).toBeUndefined();
    await ctx.fiber.dispose();
  });

  it("mounts without a session spine (tool-registry-only host)", async () => {
    const ctx = new Context();
    await ctx.plugin(LoggerPlugin);
    await ctx.plugin(ToolsPlugin);
    await ctx.plugin(
      createMcpPlugin({
        servers: { missing: { command: "definitely-not-a-real-command-xyz", args: [] } },
      }),
    );
    expect(ctx.tools.specs().map((s) => s.name)).toEqual([]);
    await ctx.fiber.dispose();
  });
});

describe("tool output notes", () => {
  it("replaces empty tool text with an English no-content note", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    const tool = ctx.tools.get("mcp__echo__empty")!;
    const result = await tool.execute({}, ctxToolContext());
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/\[.*no content/i);
    expect(result.content).not.toMatch(/[\u4e00-\u9fff]/);
    await ctx.fiber.dispose();
  });

  it("caps oversized tool output with a truncation note", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    const tool = ctx.tools.get("mcp__echo__big")!;
    const result = await tool.execute({ size: 20_000 }, ctxToolContext());
    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBeLessThan(20_000);
    expect(result.content).toMatch(/\[.*cut|truncated/i);
    expect(result.content).not.toMatch(/[\u4e00-\u9fff]/);
    await ctx.fiber.dispose();
  });

  it("output at exactly the cap is not truncated", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    const tool = ctx.tools.get("mcp__echo__big")!;
    const result = await tool.execute({ size: 16_000 }, ctxToolContext());
    expect(result.content).toHaveLength(16_000);
    expect(result.content).not.toMatch(/truncated|cut at/i);
    await ctx.fiber.dispose();
  });

  it("truncation never splits a surrogate pair", async () => {
    const ctx = await mountMcp({ echo: { command: process.execPath, args: [fixture] } });
    const tool = ctx.tools.get("mcp__echo__big")!;
    // 15999 x's + one 2-unit emoji = 16001 units: the naive cut at 16000
    // would split the pair; the guarded cut backs off to 15999.
    const result = await tool.execute({ size: 15_999, emoji: 1 }, ctxToolContext());
    expect(result.content.slice(0, 15_999)).toMatch(/^x+$/);
    expect(result.content).toMatch(/truncated|cut at/i);
    // The character right before the note's newline is the last kept 'x' —
    // a lone high surrogate would land there on an unguarded cut.
    expect(result.content.charCodeAt(result.content.indexOf("\n") - 1)).toBe(0x78);
    await ctx.fiber.dispose();
  });
});
