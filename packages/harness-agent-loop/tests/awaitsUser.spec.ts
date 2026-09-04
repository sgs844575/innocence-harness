// awaitsUser 超时豁免（Tool.awaitsUser）：会话工具截止不适用于等待用户
// 作答的工具——只有运行停止信号能终止等待（仓库纪律：等待用户/子代理
// 结果不设墙钟超时）。对照面：普通工具在同样的小超时下必须超时。
import { describe, expect, it } from "vitest";
import { createRunLoop } from "../src";
import { PermissionEngine } from "@innocenceharness/harness-permissions";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { textMessage, type HarnessEvent, type Message } from "@innocenceharness/harness-session";
import type { Delta, Provider } from "@innocenceharness/harness-providers";
import type { Tool, ToolResult } from "@innocenceharness/harness-tools";

function scriptedProvider(turns: Array<{ text?: string; toolCalls?: string[] }>): Provider {
  let i = 0;
  return {
    id: "scripted",
    async *chat(): AsyncIterable<Delta> {
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      if (turn.text) yield { type: "text", text: turn.text };
      for (const [n, name] of (turn.toolCalls ?? []).entries()) {
        yield { type: "toolCall", id: `call_${i}_${n}`, toolName: name, args: {} };
      }
    },
  };
}

/** Blocking tool: settles only via its release callback or signal abort. */
function blockingTool(
  name: string,
  opts: { awaitsUser?: boolean; onAbortReject?: boolean } = {},
): Tool & { release: (result: ToolResult) => void } {
  const holder: { release?: (result: ToolResult) => void } = {};
  const t = {
    name,
    description: name,
    readOnly: true,
    sideEffect: "none" as const,
    ...(opts.awaitsUser ? { awaitsUser: true } : {}),
    parameters: { type: "object" },
    permissionResource: () => ({ action: "read", kind: "test", scope: name }),
    execute(_args: Record<string, unknown>, ctx: { signal: AbortSignal }) {
      return new Promise<ToolResult>((resolve, reject) => {
        holder.release = (result) => resolve(result);
        if (opts.onAbortReject) {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
        }
      });
    },
  } as unknown as Tool & { release: (result: ToolResult) => void };
  return Object.assign(t, {
    release: (result: ToolResult) => holder.release?.(result),
  });
}

async function runWithTool(
  tool: Tool,
  toolTimeoutMs: number,
): Promise<{ events: HarnessEvent[]; finish: () => Promise<void> }> {
  const kernel = new Context();
  await kernel.plugin(ToolsPlugin);
  kernel.tools.register(tool);
  const events: HarnessEvent[] = [];
  const history: Message[] = [];
  const loop = createRunLoop({
    tools: kernel.tools,
    provider: scriptedProvider([{ toolCalls: [tool.name] }, { text: "done" }]),
    permission: new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" } }),
    history,
    systemPrompt: "test",
    workspaceRoot: "/tmp/ws",
    onEvent: (event) => events.push(event),
  });
  const runPromise = loop(textMessage("user", "go"), { toolTimeoutMs });
  return {
    events,
    finish: async () => {
      await runPromise;
    },
  };
}

describe("runLoop awaitsUser timeout exemption", () => {
  it("an awaitsUser tool outlives the session tool deadline and returns its result", async () => {
    const tool = blockingTool("ask_user", { awaitsUser: true });
    const { events, finish } = await runWithTool(tool, 60);
    // 等待 2.5 倍会话截止后再释放：豁免生效则不超时，释放后正常落结果。
    await new Promise((resolve) => setTimeout(resolve, 150));
    tool.release({ content: "Q: q\nA: a" });
    await finish();
    const result = events.find((e) => e.type === "toolResult") as
      | { type: "toolResult"; content: string; outcome?: string }
      | undefined;
    expect(result?.content).toBe("Q: q\nA: a");
    expect(result?.outcome).toBe("success");
  });

  it("contrast: a plain tool under the same deadline times out", async () => {
    const tool = blockingTool("Plain", { onAbortReject: true });
    const { events, finish } = await runWithTool(tool, 60);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await finish();
    const result = events.find((e) => e.type === "toolResult") as
      | { type: "toolResult"; isError?: boolean; outcome?: string }
      | undefined;
    expect(result?.isError).toBe(true);
    expect(result?.outcome).toBe("timeout");
  });
});
