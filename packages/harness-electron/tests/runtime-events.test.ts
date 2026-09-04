// runtime-events：HarnessEvent → 宿主钩子的转译。固定 invocationId 透传：
// 工具调用/结果部分带上每次调用的关联键，供宿主把子代理运行接到时间线行上。
import { describe, expect, it } from "vitest";
import type { HarnessEvent } from "@innocenceharness/harness-session";
import type { RuntimeHooks } from "../src/runtime-types";
import { forwardHarnessEvent } from "../src/runtime-events";

function captureHooks(): RuntimeHooks & { parts: unknown[] } {
  const parts: unknown[] = [];
  return {
    parts,
    onDelta: () => {},
    onTool: (_sessionId, _messageId, part) => parts.push(part),
    onThinking: () => {},
    onCompleted: () => {},
    onError: () => {},
    askPermission: async () => "deny",
    log: () => {},
  };
}

describe("forwardHarnessEvent", () => {
  it("forwards invocationId on toolCall and toolResult parts", () => {
    const hooks = captureHooks();
    const call: HarnessEvent = {
      type: "toolCall",
      id: "call-1",
      call: { toolName: "Task", args: { prompt: "查" } },
      invocationId: "inv-7",
    };
    const result: HarnessEvent = {
      type: "toolResult",
      toolCallId: "call-1",
      content: "完成",
      durationMs: 12,
      invocationId: "inv-7",
    };

    forwardHarnessEvent(hooks, "s1", "m1", call);
    forwardHarnessEvent(hooks, "s1", "m1", result);

    expect(hooks.parts[0]).toMatchObject({
      type: "toolCall",
      id: "call-1",
      toolName: "Task",
      invocationId: "inv-7",
    });
    expect(hooks.parts[1]).toMatchObject({
      type: "toolResult",
      toolCallId: "call-1",
      durationMs: 12,
      invocationId: "inv-7",
    });
  });

  it("contextUsage 事件经可选回调透传（未提供回调时静默跳过）", () => {
    const hooks = captureHooks();
    const seen: Array<{ sessionId: string; snapshot: unknown }> = [];
    const event: HarnessEvent = {
      type: "contextUsage",
      snapshot: {
        inputTokens: 100,
        breakdown: { systemPrompt: 60, skills: 0, systemTools: 20, mcpTools: 0, messages: 20, other: 0 },
        cache: { inputTokens: 100, cachedInputTokens: 50 },
        modelId: "m",
      },
    };

    forwardHarnessEvent(hooks, "s1", "m1", event, (sessionId, snapshot) => seen.push({ sessionId, snapshot }));
    // 未提供回调：不得抛错。
    forwardHarnessEvent(hooks, "s1", "m1", event);

    expect(seen).toEqual([{ sessionId: "s1", snapshot: event.snapshot }]);
  });
});
