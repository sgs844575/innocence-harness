import { describe, expect, it } from "vitest";
import { createPendingInputMailbox, createRunLoop } from "../src";
import { PermissionEngine } from "@innocenceharness/harness-permissions";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { textMessage, type Message } from "@innocenceharness/harness-session";
import type { Delta, Provider } from "@innocenceharness/harness-providers";
import type { Tool, ToolResult } from "@innocenceharness/harness-tools";
import type { HarnessEvent } from "@innocenceharness/harness-session";

describe("createPendingInputMailbox", () => {
  it("drains entries in push order with opaque data passthrough", () => {
    const mailbox = createPendingInputMailbox();
    const data = { messageId: "m1" };
    mailbox.push(textMessage("user", "一"), data);
    mailbox.push(textMessage("user", "二"));
    expect(mailbox.size()).toBe(2);

    const drained = mailbox.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0].message.parts[0]).toMatchObject({ type: "text", text: "一" });
    expect(drained[0].data).toBe(data);
    expect(drained[1].data).toBeUndefined();
    expect(mailbox.size()).toBe(0);
    expect(mailbox.drain()).toEqual([]);
  });
});

interface Turn {
  text?: string;
  toolCalls?: Array<{ toolName: string; args?: Record<string, unknown> }>;
}

/** Provider that records every chat request's message texts and replays scripted turns. */
function recordingProvider(turns: Turn[]): { provider: Provider; requests: string[][] } {
  const requests: string[][] = [];
  let i = 0;
  return {
    requests,
    provider: {
      id: "recording",
      async *chat(req): AsyncIterable<Delta> {
        requests.push(
          req.messages.map((m) =>
            m.parts
              .map((p) => (p.type === "text" ? p.text : p.type === "toolResult" ? `[toolResult:${p.content}]` : `[${p.type}]`))
              .join(""),
          ),
        );
        const turn = turns[Math.min(i, turns.length - 1)];
        i += 1;
        if (turn.text) yield { type: "text", text: turn.text };
        for (const [n, call] of (turn.toolCalls ?? []).entries()) {
          yield { type: "toolCall", id: `call_${i}_${n}`, toolName: call.toolName, args: call.args ?? {} };
        }
      },
    },
  };
}

function fakeTool(name: string): Tool {
  return {
    name,
    description: name,
    readOnly: true,
    sideEffect: "none",
    parameters: { type: "object" },
    permissionResource: () => ({ action: "read", kind: "test", scope: name }),
    async execute(): Promise<ToolResult> {
      return { content: "ok" };
    },
  } as Tool;
}

async function setup(turns: Turn[], observeEvent?: (event: HarnessEvent) => void) {
  const kernel = new Context();
  await kernel.plugin(ToolsPlugin);
  kernel.tools.register(fakeTool("Echo"));
  const { provider, requests } = recordingProvider(turns);
  const history: Message[] = [];
  const pendingInputs = createPendingInputMailbox();
  const loop = createRunLoop({
    tools: kernel.tools,
    provider,
    permission: new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" } }),
    history,
    systemPrompt: "test",
    workspaceRoot: "/tmp/ws",
    onEvent: (event) => observeEvent?.(event),
    pendingInputs,
  });
  return { requests, history, pendingInputs, run: (text: string) => loop(textMessage("user", text)) };
}

describe("runLoop steer mailbox", () => {
  it("drains parked inputs at the next turn top, each as its own user turn", async () => {
    const { requests, history, pendingInputs, run } = await setup(
      [{ toolCalls: [{ toolName: "Echo" }] }, { text: "继续后的回答" }],
      (event) => {
        // 首个工具结果落定后泊入引导消息：下一轮轮顶（下一模型步之前）入账。
        if (event.type === "toolResult") pendingInputs.push(textMessage("user", "引导：换个方向"), { messageId: "m-steer" });
      },
    );

    const result = await run("原始问题");
    expect(result.finalText).toBe("继续后的回答");

    // 第二轮模型请求看到：原始问题 → 助手调用 → 工具结果 → 引导消息。
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(["原始问题", "[toolCall]", "[toolResult:ok]", "引导：换个方向"]);
    // 历史里引导消息是独立的 user 轮（在工具结果轮之后、最终助手轮之前）。
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user", "user", "assistant"]);
    expect(history[3].parts[0]).toMatchObject({ type: "text", text: "引导：换个方向" });
    // 全部消费：邮箱不残留。
    expect(pendingInputs.size()).toBe(0);
  });

  it("leaves inputs parked after the final turn top as a remainder for the host", async () => {
    const { history, pendingInputs, run } = await setup([{ text: "直接回答" }], (event) => {
      // 模型步中途泊入：本轮不再有下一个轮顶，消息留在邮箱里。
      if (event.type === "token") pendingInputs.push(textMessage("user", "迟到的引导"), { messageId: "m-late" });
    });

    const result = await run("问题");
    expect(result.finalText).toBe("直接回答");
    // 未注入历史；剩余项连同宿主上下文原样留在邮箱（宿主转为排队后续轮）。
    expect(history).toHaveLength(2);
    const remainder = pendingInputs.drain();
    expect(remainder).toHaveLength(1);
    expect(remainder[0].message.parts[0]).toMatchObject({ type: "text", text: "迟到的引导" });
    expect(remainder[0].data).toEqual({ messageId: "m-late" });
  });

  it("runs unchanged without a mailbox (zero-config loop)", async () => {
    const kernel = new Context();
    await kernel.plugin(ToolsPlugin);
    const { provider, requests } = recordingProvider([{ text: "答" }]);
    const history: Message[] = [];
    const loop = createRunLoop({
      tools: kernel.tools,
      provider,
      permission: new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" } }),
      history,
      systemPrompt: "test",
      workspaceRoot: "/tmp/ws",
      onEvent: () => {},
    });

    const result = await loop(textMessage("user", "问"));
    expect(result.finalText).toBe("答");
    expect(requests).toEqual([["问"]]);
  });
});
