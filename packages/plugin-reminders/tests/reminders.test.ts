import { describe, expect, it } from "vitest";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import { createRemindersPlugin, reminderTemplates } from "../src";

function makeMessage(text: string) {
  return { role: "user" as const, parts: [{ type: "text" as const, text }] };
}
const provider = { id: "anthropic" };
function makeContext(sessionId = "s", history?: () => readonly unknown[]) {
  return {
    provider,
    signal: new AbortController().signal,
    scope: { sessionId },
    ...(history ? { history } : {}),
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
      const text = t.render({
        provider,
        permissionMode: "plan",
        firstTurn: true,
        ownerSession: true,
        usageLevel: { inputTokens: 96000, outputTokens: 24000, cachedInputTokens: 5000, totalTokens: 120000 },
        continuation: true,
      });
      expect(text).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(text).not.toMatch(re);
      }
      expect(t.id.length).toBeGreaterThan(0);
    }
  });
});

describe("todo freshness reminder", () => {
  const openList = [{ content: "wire the port", status: "pending", priority: "high" }];
  const doneList = [{ content: "wire the port", status: "completed", priority: "high" }];

  function todoCall(todos: unknown, id = "tc-1") {
    return {
      role: "assistant" as const,
      parts: [{ type: "toolCall" as const, id, toolName: "TodoWrite", args: { todos } }],
    };
  }
  const filler = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: "user" as const,
      parts: [{ type: "text" as const, text: `turn ${i}` }],
    }));

  async function runWith(history?: () => readonly unknown[]) {
    const plugin = createRemindersPlugin({ getPermissionMode: () => "auto" });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const message = makeMessage("go");
    await processors[0].process(message, makeContext("s", history));
    return textOf(message);
  }

  it("injects when open entries exist and the list was last touched five messages back", async () => {
    const text = await runWith(() => [todoCall(openList), ...filler(5)]);
    expect(text).toMatch(/task list/i);
    expect(text).toMatch(/<system-reminder>/);
  });

  it("does not inject when the list was refreshed four messages back (inside the window)", async () => {
    const text = await runWith(() => [todoCall(openList), ...filler(4)]);
    expect(text).not.toMatch(/task list/i);
  });

  it("does not inject when the list was just refreshed", async () => {
    const text = await runWith(() => [...filler(5), todoCall(openList)]);
    expect(text).not.toMatch(/task list/i);
  });

  it("does not inject when every entry is completed", async () => {
    const text = await runWith(() => [todoCall(doneList), ...filler(5)]);
    expect(text).not.toMatch(/task list/i);
  });

  it("does not inject when the session history holds no list-tool call (child sessions)", async () => {
    const text = await runWith(() => [...filler(6)]);
    expect(text).not.toMatch(/task list/i);
  });

  it("does not inject on malformed list args (non-array todos)", async () => {
    const text = await runWith(() => [todoCall("not-a-list"), ...filler(5)]);
    expect(text).not.toMatch(/task list/i);
  });

  it("does not inject and does not throw when the context carries no history accessor", async () => {
    await expect(runWith()).resolves.not.toMatch(/task list/i);
  });
});

describe("usage-level reminder", () => {
  const usage = (totalTokens: number, cachedInputTokens = 0) => ({
    inputTokens: Math.floor(totalTokens * 0.8),
    outputTokens: totalTokens - Math.floor(totalTokens * 0.8),
    cachedInputTokens,
    totalTokens,
  });

  async function runTurns(
    getSessionUsage: () => unknown | undefined,
    turns: number,
    sessionId = "s",
  ): Promise<string[]> {
    const plugin = createRemindersPlugin({
      getPermissionMode: () => "auto",
      getSessionUsage: getSessionUsage as () => never,
    });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const texts: string[] = [];
    for (let i = 0; i < turns; i++) {
      const message = makeMessage("go");
      await processors[0].process(message, makeContext(sessionId));
      texts.push(textOf(message));
    }
    return texts;
  }

  it("stays silent below the first threshold of 100k total tokens", async () => {
    const [turn] = await runTurns(() => usage(99_999), 1);
    expect(turn).not.toMatch(/token usage|usage has reached/i);
  });

  it("injects once when cumulative total tokens reach 100k, with the counts", async () => {
    const [turn] = await runTurns(() => usage(120_000, 5_000), 1);
    expect(turn).toMatch(/usage/i);
    expect(turn).toContain("120000");
    expect(turn).toContain("96000"); // input share
    expect(turn).toContain("24000"); // output share
    expect(turn).toContain("5000"); // cached share
  });

  it("does not re-inject before usage grows by half over the injected level", async () => {
    let total = 120_000;
    const plugin = createRemindersPlugin({
      getPermissionMode: () => "auto",
      getSessionUsage: () => usage(total),
    });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const first = makeMessage("go");
    await processors[0].process(first, makeContext());
    expect(textOf(first)).toMatch(/usage/i);
    total = 179_999; // below 120000 * 1.5
    const near = makeMessage("more");
    await processors[0].process(near, makeContext());
    expect(textOf(near)).not.toMatch(/usage/i);
  });

  it("re-injects once usage reaches 150% of the last injected level", async () => {
    let total = 120_000;
    const plugin = createRemindersPlugin({
      getPermissionMode: () => "auto",
      getSessionUsage: () => usage(total),
    });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const first = makeMessage("go");
    await processors[0].process(first, makeContext());
    expect(textOf(first)).toMatch(/usage/i);
    const growth = makeMessage("more");
    await processors[0].process(growth, makeContext());
    expect(textOf(growth)).not.toMatch(/usage/i);
    total = 180_000;
    const crossed = makeMessage("even more");
    await processors[0].process(crossed, makeContext());
    expect(textOf(crossed)).toMatch(/usage/i);
    expect(textOf(crossed)).toContain("180000");
  });

  it("never injects when no usage getter is supplied", async () => {
    const plugin = createRemindersPlugin({ getPermissionMode: () => "auto" });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const message = makeMessage("go");
    await processors[0].process(message, makeContext());
    expect(textOf(message)).not.toMatch(/usage/i);
  });

  it("child sessions never see the usage reminder nor consume the watermark", async () => {
    // The parent crosses the threshold; a later child turn (inherited
    // processor instance, parent ran first as in production) must stay
    // silent, and the parent's watermark must survive the child turn.
    let total = 120_000;
    const plugin = createRemindersPlugin({
      getPermissionMode: () => "auto",
      getSessionUsage: () => usage(total),
    });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const parent = makeMessage("go");
    await processors[0].process(parent, makeContext("parent"));
    expect(textOf(parent)).toMatch(/usage/i);
    const child = makeMessage("findings please");
    await processors[0].process(child, makeContext("child"));
    expect(textOf(child)).not.toMatch(/token usage/i);
    total = 150_000; // below 120000 * 1.5 — watermark untouched by the child turn
    const parentAgain = makeMessage("more");
    await processors[0].process(parentAgain, makeContext("parent"));
    expect(textOf(parentAgain)).not.toMatch(/token usage/i);
  });
});

describe("session-continuation reminder", () => {
  async function runFirstTurn(
    isContinuationSession: (() => boolean) | undefined,
    sessionId = "s",
  ): Promise<string> {
    const plugin = createRemindersPlugin({
      getPermissionMode: () => "auto",
      ...(isContinuationSession ? { isContinuationSession } : {}),
    });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const message = makeMessage("continue");
    await processors[0].process(message, makeContext(sessionId));
    return textOf(message);
  }

  it("injects on the first turn of a continued session", async () => {
    const text = await runFirstTurn(() => true);
    expect(text).toMatch(/resumed|continued/i);
    expect(text).toMatch(/re-check|re-validate|recheck/i);
  });

  it("injects only once — the second turn stays silent", async () => {
    const plugin = createRemindersPlugin({
      getPermissionMode: () => "auto",
      isContinuationSession: () => true,
    });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const first = makeMessage("continue");
    await processors[0].process(first, makeContext());
    expect(textOf(first)).toMatch(/resumed|continued/i);
    const second = makeMessage("again");
    await processors[0].process(second, makeContext());
    expect(textOf(second)).not.toMatch(/resumed|continued/i);
  });

  it("does not inject for fresh sessions or when no getter is supplied", async () => {
    expect(await runFirstTurn(() => false)).not.toMatch(/resumed|continued/i);
    expect(await runFirstTurn(undefined)).not.toMatch(/resumed|continued/i);
  });

  it("does not inject in inherited child sessions", async () => {
    // The parent consumed the first turn; the child session's own first turn
    // (inherited processor instance) must not see the continuation note.
    const plugin = createRemindersPlugin({
      getPermissionMode: () => "auto",
      isContinuationSession: () => true,
    });
    const processors: MessageProcessor[] = [];
    plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
    const parent = makeMessage("go");
    await processors[0].process(parent, makeContext("parent"));
    expect(textOf(parent)).toMatch(/resumed|continued/i);
    const child = makeMessage("findings please");
    await processors[0].process(child, makeContext("child"));
    expect(textOf(child)).not.toMatch(/resumed|continued/i);
  });
});
