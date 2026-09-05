import { describe, expect, it } from "vitest";
import { ContextManager, estimateTokens, textMessage, type Provider } from "../src";

const provider: Provider = {
  id: "summary",
  async *chat() { yield { type: "text", text: "Completed investigation; implementation remains." }; },
};
const history = () => Array.from({ length: 60 }, (_, i) =>
  textMessage(i % 2 ? "assistant" : "user", "x".repeat(1000)));

describe("window-aware compaction", () => {
  it("uses the configured window and accounts for request overhead", () => {
    const messages = history();
    expect(new ContextManager({ contextWindow: 100_000 }).needsCompaction(messages)).toBe(false);
    expect(new ContextManager({ contextWindow: 20_000 }).needsCompaction(messages)).toBe(true);
    const manager = new ContextManager({ contextWindow: 30_000 });
    expect(manager.needsCompaction(messages)).toBe(false);
    expect(manager.needsCompaction(messages, 10_000)).toBe(true);
  });

  it("keeps a token-budgeted suffix and leaves room for cached append-only steps", async () => {
    const messages = history();
    const original = [...messages];
    const manager = new ContextManager({ contextWindow: 20_000 });
    expect(await manager.maybeCompact(messages, provider)).toBe(true);
    expect(messages.length).toBeGreaterThan(7);
    expect(estimateTokens(messages)).toBeLessThan(8500);
    expect(messages.slice(1)).toEqual(original.slice(-(messages.length - 1)));
    expect(messages.at(-1)).toBe(original.at(-1));
    const prefix = JSON.stringify(messages);
    expect(await manager.maybeCompact(messages, provider)).toBe(false);
    expect(JSON.stringify(messages)).toBe(prefix);
    messages.push(textMessage("user", "Continue."));
    expect(await manager.maybeCompact(messages, provider)).toBe(false);
  });

  it("falls back for invalid windows and keeps oversized recent messages intact", async () => {
    expect(new ContextManager({ contextWindow: NaN }).needsCompaction(history())).toBe(false);
    const messages = [textMessage("user", "x".repeat(100_000))];
    const before = JSON.stringify(messages);
    expect(await new ContextManager({ contextWindow: 1000 }).maybeCompact(messages, provider)).toBe(false);
    expect(JSON.stringify(messages)).toBe(before);
  });
});
