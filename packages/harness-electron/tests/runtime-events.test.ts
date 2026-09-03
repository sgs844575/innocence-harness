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
});
