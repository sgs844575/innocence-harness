// Wire-level prompt-cache discipline: drives the real provider clients with a
// capturing fetch (requests fail with 400 after the body is captured) and
// asserts that consecutive turns serialize to an identical cacheable prefix —
// identical tools, identical system block, byte-equal earlier messages — with
// the anthropic breakpoints placed on the documented boundaries and nothing
// marked on other protocols. These tests pin the prefix-stability contract
// the runtime's cache hit rate depends on.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Message, ProviderModel } from "@innocenceharness/harness-providers";
import { describe, expect, it } from "vitest";
import { createModelFactory, streamOneHarnessStep } from "../src/index";

const SYSTEM = "You are a harness agent. Be terse.";

const TOOLS = [
  {
    name: "shell",
    description: "run a command",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  { name: "read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
];

function capturingFetch(log: unknown[]): typeof fetch {
  return (async (_input: unknown, init?: RequestInit) => {
    log.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(
      JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "probe" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

async function drive(model: ProviderModel, history: Message[]): Promise<void> {
  for await (const _event of streamOneHarnessStep({ model, system: SYSTEM, messages: history, tools: TOOLS })) {
    void _event;
  }
}

const turn1: Message[] = [{ role: "user", parts: [{ type: "text", text: "list the files" }] }];
const turn2: Message[] = [
  ...turn1,
  {
    role: "assistant",
    parts: [
      { type: "thinking", text: "hmm" },
      { type: "text", text: "checking" },
      { type: "toolCall", id: "call-1", toolName: "shell", args: { command: "ls" } },
    ],
  },
  { role: "user", parts: [{ type: "toolResult", toolCallId: "call-1", content: "a.txt\nb.ts" }] },
];
const turn3: Message[] = [
  ...turn2,
  { role: "assistant", parts: [{ type: "text", text: "there are two files" }] },
  { role: "user", parts: [{ type: "text", text: "open a.txt" }] },
];

type Block = { cache_control?: unknown };
type WireMessage = { role: string; content: Block[] | string };

interface WireBody {
  system?: Block[];
  messages: WireMessage[];
  tools: { cache_control?: unknown }[];
}

function stripCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCacheControl);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "cache_control") continue;
      out[k] = stripCacheControl(v);
    }
    return out;
  }
  return value;
}

function stripMessageMarkers(message: WireMessage): WireMessage {
  return { ...message, content: stripCacheControl(message.content) } as WireMessage;
}

function breakpointCount(value: unknown): number {
  return JSON.stringify(value).split('"cache_control"').length - 1;
}

describe("anthropic wire prefix cache discipline", () => {
  it("keeps tools, system, and earlier messages byte-identical across turns with breakpoints on the documented boundaries", async () => {
    const log: unknown[] = [];
    const factory = createModelFactory({
      createAnthropic: (settings) => {
        const client = createAnthropic({ ...settings, fetch: capturingFetch(log) } as Parameters<typeof createAnthropic>[0]);
        return { chat: (id: string) => client(id) };
      },
    });
    const model = factory.create({ providerId: "probe-a", protocol: "anthropic", modelId: "m1", credential: "k" });

    await drive(model, turn1);
    await drive(model, turn2);
    await drive(model, turn3);
    expect(log.length).toBe(3);
    const bodies = log as WireBody[];
    const [b1, b2, b3] = bodies;

    // Tools: identical every request, breakpoint on the LAST tool only.
    for (const body of bodies) {
      expect(stripCacheControl(body.tools)).toEqual(stripCacheControl(b1.tools));
      expect(body.tools.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
      expect(body.tools.slice(0, -1).every((tool) => tool.cache_control === undefined)).toBe(true);
    }

    // System: identical every request with breakpoint 2 on the block.
    for (const body of bodies) {
      expect(body.system).toEqual(b1.system);
      expect(b1.system?.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    }

    // Earlier messages: byte-identical once the moved markers are stripped.
    expect(b2.messages.slice(0, b1.messages.length).map(stripMessageMarkers))
      .toEqual(b1.messages.map(stripMessageMarkers));
    expect(b3.messages.slice(0, b2.messages.length).map(stripMessageMarkers))
      .toEqual(b2.messages.map(stripMessageMarkers));

    // Breakpoint budget: last tool + system + previous-turn checkpoint + last
    // message = 4 (first turn has no checkpoint and carries 3). Never more.
    expect(b1.messages.at(-1)?.content !== undefined).toBe(true);
    const counts = bodies.map((body) => breakpointCount(body));
    expect(counts[1]).toBe(4);
    expect(counts[2]).toBe(4);
    expect(counts[0]).toBeLessThanOrEqual(counts[1]);

    // Placement: the last message's last block carries the rolling breakpoint
    // (turn 2 ends with a tool_result block), and the checkpoint sits on the
    // message before the final assistant message.
    const lastBlocks = (body: WireBody): Block[] => {
      const content = body.messages.at(-1)?.content;
      return typeof content === "string" ? [] : (content ?? []);
    };
    for (const body of bodies) {
      expect(lastBlocks(body).at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    }
    const t2Checkpoint = b2.messages[b2.messages.length - 3];
    const t2CheckpointContent = typeof t2Checkpoint?.content === "string" ? [] : (t2Checkpoint?.content ?? []);
    expect(t2CheckpointContent.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    // The checkpoint coincides with turn 1's rolling boundary: strip markers
    // and the two bodies agree through that position (already asserted above
    // via full-prefix identity; here we pin the boundary explicitly).
    expect(t2Checkpoint?.role).toBe("user");
  });
});

describe("openai-compatible wire prefix cache discipline", () => {
  it("carries no cache markers and keeps an identical prefix across turns", async () => {
    const log: unknown[] = [];
    const factory = createModelFactory({
      createOpenAICompatible: (settings) => {
        const client = createOpenAICompatible({
          ...settings,
          baseURL: "http://probe.test/v1",
          fetch: capturingFetch(log),
        } as Parameters<typeof createOpenAICompatible>[0]);
        return { chatModel: (id: string) => client(id) };
      },
    });
    const model = factory.create({ providerId: "probe-o", protocol: "openai-compatible", modelId: "m1", credential: "k" });

    await drive(model, turn1);
    await drive(model, turn2);
    await drive(model, turn3);
    expect(log.length).toBe(3);

    for (const body of log as Record<string, unknown>[]) {
      expect(JSON.stringify(body)).not.toContain("cache_control");
      expect(JSON.stringify(body)).not.toContain("providerOptions");
    }

    // Implicit prefix caching (server-side) keys on the serialized prompt:
    // tools identical, message prefix identical turn over turn.
    const bodies = log as { tools: unknown[]; messages: unknown[] }[];
    expect(bodies[1]!.tools).toEqual(bodies[0]!.tools);
    expect(bodies[2]!.tools).toEqual(bodies[0]!.tools);
    expect(bodies[1]!.messages.slice(0, bodies[0]!.messages.length)).toEqual(bodies[0]!.messages);
    expect(bodies[2]!.messages.slice(0, bodies[1]!.messages.length)).toEqual(bodies[1]!.messages);
  });
});
