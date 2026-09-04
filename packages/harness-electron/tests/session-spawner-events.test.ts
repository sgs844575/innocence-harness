// 子代理会话事件转发（createSpawnerChildSession 直测，静态脊柱）：
// 子会话内部的 toolCall/toolResult 转发给宿主——call 携带 args、result 携带
// 输出文本（spawner 将其投影为一行 title/有界摘录后才进入 lifecycle，原始
// 载荷不出 spawner），result 事件经局部 toolCallId→name 表补回工具名。
import { describe, expect, it } from "vitest";
import { PermissionEngine } from "@innocenceharness/harness-permissions";
import type { SpawnerChildMaterials, SubagentChildEvent } from "@innocenceharness/harness-agent";
import type { Delta, Provider } from "@innocenceharness/harness-providers";
import type { Tool } from "@innocenceharness/harness-tools";
import { createSpawnerChildSession } from "../src/session-spawner";
import { staticSpineSuite } from "../src/session-spine";
import type { AgentSessionOptions } from "../src/session-options";

const allowEngine = () =>
  new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" as const } });

/** 两轮脚本：首轮思考 + 一个 Probe 工具调用，次轮纯文本收尾。 */
function scriptedProvider(): Provider {
  let turn = 0;
  return {
    id: "scripted",
    async *chat(): AsyncIterable<Delta> {
      turn += 1;
      if (turn === 1) {
        yield { type: "thinking", text: "推理" };
        yield { type: "toolCall", id: "call_1", toolName: "Probe", args: {} };
      } else yield { type: "text", text: "子代理结论" };
    },
  };
}

function probeTool(): Tool {
  return {
    name: "Probe",
    description: "probe",
    readOnly: true,
    sideEffect: "none",
    parameters: { type: "object" },
    permissionResource: () => ({ action: "read", kind: "test", scope: "probe" }),
    async execute() {
      return { content: "probe-done" };
    },
  };
}

function materials(): SpawnerChildMaterials {
  return {
    tools: [probeTool()],
    processors: [],
    middlewares: [],
    provider: scriptedProvider(),
    permission: allowEngine(),
    systemPrompt: "CHILD",
    maxTurns: 5,
    logger: () => {},
  };
}

function parentOptions(): AgentSessionOptions {
  return {
    plugins: [],
    workspaceRoot: "D:/tmp",
    permission: { mode: "auto", decider: { ask: async () => "deny" as const } },
    spine: staticSpineSuite(),
  };
}

describe("spawner child event forwarding", () => {
  it("forwards child text, toolCall and toolResult (result name resolved from the call)", async () => {
    const child = await createSpawnerChildSession(parentOptions(), materials());
    const events: SubagentChildEvent[] = [];
    const result = await child.run("任务", undefined, {}, (event) => events.push(event));

    expect(result.finalText).toBe("子代理结论");
    expect(events).toContainEqual({ type: "thinking", text: "推理" } as SubagentChildEvent);
    expect(events).toContainEqual({ type: "toolCall", name: "Probe", args: {} });
    expect(events).toContainEqual({ type: "toolResult", name: "Probe", isError: false, result: "probe-done" });
    expect(events).toContainEqual({ type: "text", text: "子代理结论" });
    await child.dispose();
  });
});
