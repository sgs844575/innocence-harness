import { describe, expect, it } from "vitest";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import { createRemindersPlugin, reminderTemplates } from "../src";

function makeMessage(text: string) {
  return { role: "user" as const, parts: [{ type: "text" as const, text }] };
}
const provider = { id: "anthropic" };
function makeContext(sessionId = "s") {
  return {
    provider,
    signal: new AbortController().signal,
    scope: { sessionId },
  } as never;
}
const textOf = (m: { parts: Array<{ type: string; text?: string }> }) =>
  m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");

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
    expect(textOf(normal)).not.toMatch(/planning permission|plan mode/i);
    permissionMode = "plan";
    const planned = makeMessage("go2");
    await processor.process(planned, makeContext());
    expect(textOf(planned)).toMatch(/planning permission|plan mode/i);
  });

  it("keeps the plan-permission reminder inside the session that first used the processor", async () => {
    // Child sessions inherit the parent's identical processor instances
    // (subagent spawner), and the child's run passes through the same
    // processUserInput pipeline — so plan-mode gating must be per session,
    // not per plugin instance. The parent (first user of the instance)
    // keeps the reminder; an inherited child session does not, while the
    // provider-context reminder still applies to it.
    const plugin = createRemindersPlugin({ getPermissionMode: () => "plan" });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const processor = processors[0];
    const parent = makeMessage("go");
    await processor.process(parent, makeContext("parent"));
    expect(textOf(parent)).toMatch(/planning permission|plan mode/i);
    const child = makeMessage("research this and return findings");
    await processor.process(child, makeContext("child"));
    expect(textOf(child)).not.toMatch(/planning permission|plan mode/i);
    expect(textOf(child)).toMatch(/provider/i);
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
      const text = t.render({ provider, permissionMode: "plan", firstTurn: true, ownerSession: true });
      expect(text).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(text).not.toMatch(re);
      }
      expect(t.id.length).toBeGreaterThan(0);
    }
  });
});
