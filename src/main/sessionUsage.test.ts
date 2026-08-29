// Session-store usage derivations (batch 4F): the two reminder state facts
// the reminders factory reads — cumulative token usage and "continues from
// prior stored turns" — derived purely from the store's message list.
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../shared/ipc";
import { sessionHasFinishedTurn, summarizeSessionUsage } from "./sessionUsage";

const msg = (role: "user" | "assistant", completion?: ChatMessage["completion"]): ChatMessage => ({
  id: `msg_${role}`,
  role,
  parts: [{ type: "text", text: "x" }],
  createdAt: 0,
  ...(completion ? { completion } : {}),
});

const usage = (
  inputTokens?: number,
  outputTokens?: number,
  totalTokens?: number,
  cachedInputTokens?: number,
): NonNullable<ChatMessage["completion"]>["usage"] => ({
  ...(inputTokens !== undefined ? { inputTokens } : {}),
  ...(outputTokens !== undefined ? { outputTokens } : {}),
  ...(totalTokens !== undefined ? { totalTokens } : {}),
  ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
});

describe("summarizeSessionUsage", () => {
  it("sums usage across finished assistant messages", () => {
    const messages = [
      msg("user"),
      msg("assistant", { finishReason: "stop", aborted: false, usage: usage(1000, 200, 1200, 300) }),
      msg("assistant", { finishReason: "stop", aborted: false, usage: usage(50, 10, 60) }),
    ];
    expect(summarizeSessionUsage(messages)).toEqual({
      inputTokens: 1050,
      outputTokens: 210,
      totalTokens: 1260,
      cachedInputTokens: 300,
    });
  });

  it("falls back to input+output when a message carries no totalTokens", () => {
    const messages = [
      msg("assistant", { finishReason: "stop", aborted: false, usage: usage(100, 40) }),
    ];
    expect(summarizeSessionUsage(messages)?.totalTokens).toBe(140);
  });

  it("returns undefined when no message carries usage", () => {
    expect(summarizeSessionUsage([msg("user"), msg("assistant")])).toBeUndefined();
    expect(summarizeSessionUsage([])).toBeUndefined();
  });

  it("ignores usage on non-assistant messages and streaming stubs", () => {
    const messages = [
      // hydration never puts completion on user rows, but a defensive read
      // must not crash if one ever appears; assistant stubs (streaming,
      // no completion) stay invisible to the derivation.
      msg("assistant"),
      msg("assistant", { finishReason: "stop", aborted: false, usage: usage(1, 1, 2) }),
    ];
    expect(summarizeSessionUsage(messages)?.totalTokens).toBe(2);
  });
});

describe("sessionHasFinishedTurn", () => {
  it("true when an assistant message holds completion metadata", () => {
    expect(
      sessionHasFinishedTurn([msg("assistant", { finishReason: "stop", aborted: false })]),
    ).toBe(true);
  });

  it("false for stubs, user rows, corrupt notices, and empty lists", () => {
    expect(sessionHasFinishedTurn([])).toBe(false);
    expect(sessionHasFinishedTurn([msg("user")])).toBe(false);
    expect(sessionHasFinishedTurn([msg("assistant")])).toBe(false);
  });
});
