import { Context } from "@innocenceharness/kernel";
import {
  createSessionPlugin,
  DEFAULT_COMPACTION,
  type Delta,
  type HarnessEvent,
  type Message,
  type MessageProcessor,
  type Provider,
  type SessionService,
} from "@innocenceharness/harness-session";
import { describe, expect, expectTypeOf, it } from "vitest";

// Mirrors harness-tools' test setup: load the plugin into a fresh kernel
// context; `ctx.session` is live while the plugin fiber is active.
function echoProvider(): Provider {
  return { id: "echo", async *chat(): AsyncIterable<Delta> {} };
}

async function withSession(
  overrides: Partial<{ provider: Provider; sessionId: string; compaction: { maxContextTokens: number; keepRecent: number } }> = {},
): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(
    createSessionPlugin({
      provider: echoProvider(),
      sessionId: "sess-test",
      ...overrides,
    }),
  );
  return ctx;
}

describe("processor registration", () => {
  it("keeps registration order (registry registerMessageProcessor semantics)", async () => {
    const ctx = await withSession();
    const first: MessageProcessor = { name: "first", order: 0, async process(m) { return m; } };
    const second: MessageProcessor = { name: "second", order: 0, async process(m) { return m; } };
    ctx.session.registerProcessor(first);
    ctx.session.registerProcessor(second);
    expect(ctx.session.processors().map((p) => p.name)).toEqual(["first", "second"]);
  });

  it("processors exposes a readonly view (type-level gate)", async () => {
    const ctx = await withSession();
    expectTypeOf(ctx.session.processors()).toEqualTypeOf<readonly MessageProcessor[]>();
  });
});

describe("processUserInput", () => {
  it("processes a canonical user message through the pipeline before the caller stores history", async () => {
    const ctx = await withSession();
    ctx.session.registerProcessor({
      name: "append",
      order: 0,
      async process(message) {
        return { ...message, parts: [...message.parts, { type: "text", text: " processed" }] };
      },
    });

    const processed = await ctx.session.processUserInput({
      role: "user",
      parts: [{ type: "text", text: "input" }],
    });
    expect(processed).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "input" }, { type: "text", text: " processed" }],
    });
    // The service provides the pipeline only; ledger pushes belong to the
    // caller (the loop), so history stays untouched here.
    expect(ctx.session.history).toHaveLength(0);
  });

  it("returns the message unchanged when no processor is registered", async () => {
    const ctx = await withSession();
    const message = { role: "user" as const, parts: [{ type: "text" as const, text: "hi" }] };
    await expect(ctx.session.processUserInput(message)).resolves.toEqual(message);
  });

  it("hands processors the session provider and scope identity", async () => {
    const provider = echoProvider();
    const ctx = await withSession({ provider, sessionId: "sess-7" });
    const seen: Array<{ providerId: string; sessionId: string; signal: AbortSignal }> = [];
    ctx.session.registerProcessor({
      name: "spy",
      order: 0,
      async process(message, context) {
        seen.push({
          providerId: context.provider.id,
          sessionId: context.scope.sessionId,
          signal: context.signal,
        });
        return message;
      },
    });
    const signal = new AbortController().signal;
    await ctx.session.processUserInput(
      { role: "user", parts: [{ type: "text", text: "x" }] },
      signal,
    );
    expect(seen).toEqual([{ providerId: "echo", sessionId: "sess-7", signal }]);
  });

  it("hands processors a history accessor that mirrors the caller-owned ledger", async () => {
    const ctx = await withSession();
    ctx.session.history.push({ role: "user", parts: [{ type: "text", text: "one" }] });
    const accessors: Array<() => readonly Message[]> = [];
    ctx.session.registerProcessor({
      name: "history-spy",
      order: 0,
      async process(message, context) {
        accessors.push(context.history ?? (() => []));
        return message;
      },
    });
    await ctx.session.processUserInput({ role: "user", parts: [{ type: "text", text: "a" }] });
    expect(accessors[0]()).toHaveLength(1);
    // Later ledger pushes by the caller show up on later accessor reads.
    ctx.session.history.push({ role: "assistant", parts: [{ type: "text", text: "two" }] });
    await ctx.session.processUserInput({ role: "user", parts: [{ type: "text", text: "b" }] });
    expect(accessors[1]()).toHaveLength(2);
  });

  it("keeps the history accessor read-only: mutating a returned array cannot reach the ledger", async () => {
    const ctx = await withSession();
    ctx.session.history.push({ role: "user", parts: [{ type: "text", text: "one" }] });
    let accessor: (() => readonly Message[]) | undefined;
    ctx.session.registerProcessor({
      name: "history-spy",
      order: 0,
      async process(message, context) {
        accessor = context.history;
        return message;
      },
    });
    await ctx.session.processUserInput({ role: "user", parts: [{ type: "text", text: "a" }] });
    // Intentional unsafe cast: the point under test is that a processor
    // mutating what it got back leaves the session ledger untouched.
    (accessor!() as Message[]).push({ role: "user", parts: [{ type: "text", text: "evil" }] });
    expect(ctx.session.history).toHaveLength(1);
  });
});

describe("event broadcast", () => {
  it("broadcasts HarnessEvents on the kernel bus under \"harness/event\"", async () => {
    const ctx = await withSession();
    const seen: HarnessEvent[] = [];
    ctx.on("harness/event", (event) => seen.push(event));

    ctx.session.emit({ type: "turnStart", turn: 1 });
    ctx.session.emit({ type: "token", text: "你好" });
    ctx.session.emit({ type: "done", turns: 1 });

    expect(seen).toEqual([
      { type: "turnStart", turn: 1 },
      { type: "token", text: "你好" },
      { type: "done", turns: 1 },
    ]);
  });

  it("stops broadcasting once the plugin fiber is disposed", async () => {
    const ctx = new Context();
    const plugin = createSessionPlugin({ provider: echoProvider(), sessionId: "sess-x" });
    const fiber = await ctx.plugin(plugin);
    const service = ctx.session;
    const seen: HarnessEvent[] = [];
    ctx.on("harness/event", (event) => seen.push(event));
    service.emit({ type: "done", turns: 0 });
    await fiber.dispose();
    // After the unwind the service is detached; its emit is inert.
    service.emit({ type: "done", turns: 1 });
    expect(seen).toEqual([{ type: "done", turns: 0 }]);
  });
});

describe("compactor holding", () => {
  it("owns a ContextManager built with the injected compaction options", async () => {
    const ctx = await withSession({ compaction: { maxContextTokens: 1_000, keepRecent: 2 } });
    expect(ctx.session.compactor.options).toEqual({ maxContextTokens: 1_000, keepRecent: 2 });
  });

  it("defaults to DEFAULT_COMPACTION when no options are injected", async () => {
    const ctx = await withSession();
    expect(ctx.session.compactor.options).toEqual(DEFAULT_COMPACTION);
  });
});

describe("session service lifecycle on the kernel", () => {
  it("carries the spine plugin name \"harness-session\"", () => {
    const plugin = createSessionPlugin({ provider: echoProvider(), sessionId: "sess-n" });
    expect(plugin.name).toBe("harness-session");
  });

  it("publishes the service under \"session\" while its fiber is active", async () => {
    const ctx = await withSession();
    expect((ctx as { session?: SessionService }).session).toBeDefined();
    ctx.session.registerProcessor({ name: "p", order: 0, async process(m) { return m; } });
    expect(ctx.session.processors().map((p) => p.name)).toEqual(["p"]);
  });

  it("withdraws the service when the plugin fiber is disposed", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(
      createSessionPlugin({ provider: echoProvider(), sessionId: "sess-y" }),
    );
    const service = ctx.session;
    expect((ctx as { session?: SessionService }).session).toBeDefined();
    await fiber.dispose();
    // The withdraw handle returned by `apply` removed the context property;
    // the detached service object stays inert but usable.
    expect((ctx as { session?: SessionService }).session).toBeUndefined();
    expect(() =>
      service.registerProcessor({ name: "late", order: 0, async process(m) { return m; } }),
    ).not.toThrow();
  });

  it("exposes a session-level history ledger the caller owns", async () => {
    const ctx = await withSession();
    ctx.session.history.push({ role: "user", parts: [{ type: "text", text: "hi" }] });
    expect(ctx.session.history).toHaveLength(1);
  });
});
