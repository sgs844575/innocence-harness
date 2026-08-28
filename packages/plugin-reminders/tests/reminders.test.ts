import { describe, expect, it } from "vitest";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import { createRemindersPlugin, reminderTemplates } from "../src";

function makeMessage(text: string) {
  return { role: "user" as const, parts: [{ type: "text" as const, text }] };
}
const provider = { id: "anthropic" };
function makeContext() {
  return {
    provider,
    signal: new AbortController().signal,
    scope: { sessionId: "s" },
  } as never;
}

describe("reminder processor", () => {
  it("registers a single processor named reminders at order 900", () => {
    let permissionMode = "auto";
    const plugin = createRemindersPlugin({ getPermissionMode: () => permissionMode });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    expect(processors).toHaveLength(1);
    expect(processors[0].name).toBe("reminders");
    expect(processors[0].order).toBe(900);
  });

  it("injects provider context every turn and trust boundary only on the first", async () => {
    let permissionMode = "auto";
    const plugin = createRemindersPlugin({ getPermissionMode: () => permissionMode });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const processor = processors[0];
    const first = makeMessage("hello");
    await processor.process(first, makeContext());
    const firstTexts = first.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
    expect(firstTexts).toMatch(/provider/i);
    expect(firstTexts).toMatch(/untrusted|untrust/i);
    const second = makeMessage("again");
    await processor.process(second, makeContext());
    const secondTexts = second.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
    expect(secondTexts).toMatch(/provider/i);
    expect(secondTexts).not.toMatch(/untrusted|untrust/i);
  });

  it("injects the plan-permission reminder only while permission mode is plan", async () => {
    let permissionMode = "auto";
    const plugin = createRemindersPlugin({ getPermissionMode: () => permissionMode });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const processor = processors[0];
    const normal = makeMessage("go");
    await processor.process(normal, makeContext());
    expect(normal.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")).not.toMatch(/planning permission|plan mode/i);
    permissionMode = "plan";
    const planned = makeMessage("go2");
    await processor.process(planned, makeContext());
    expect(planned.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")).toMatch(/planning permission|plan mode/i);
  });

  it("does not mutate the original user text part", async () => {
    const plugin = createRemindersPlugin({ getPermissionMode: () => "auto" });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const message = makeMessage("hello");
    await processors[0].process(message, makeContext());
    expect(message.parts[0]).toEqual({ type: "text", text: "hello" });
  });

  it("templates are English and banned-token free", () => {
    for (const t of reminderTemplates) {
      const text = t.render({ provider, permissionMode: "plan", firstTurn: true });
      expect(text).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(text).not.toMatch(re);
      }
      expect(t.id.length).toBeGreaterThan(0);
    }
  });
});
