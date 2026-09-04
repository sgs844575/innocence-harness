import { describe, expect, it } from "vitest";
import { breakdownFromRequest, calibrate } from "../src/meter";

const req = {
  systemSegments: { prompt: "abcd", skills: "上下上下" }, // 1 + 4
  tools: [
    { name: "read_file", schemaText: "abcdefgh" },        // 2 → systemTools
    { name: "mcp__srv__tool", schemaText: "abcdefgh" },   // 2 → mcpTools
  ],
  messages: [
    { role: "user" as const, parts: [{ type: "text", text: "abcdefgh" }] },              // 2
    { role: "assistant" as const, parts: [{ type: "toolCall", toolName: "t", args: { a: 1 } }] }, // JSON 文本 >0
    { role: "user" as const, parts: [{ type: "toolResult", content: "abcdefgh" }] },     // 2
  ],
};

describe("breakdownFromRequest", () => {
  it("按段拆五类：mcp__ 前缀进 mcpTools，skills 单列", () => {
    const raw = breakdownFromRequest(req);
    expect(raw.systemPrompt).toBe(1);
    expect(raw.skills).toBe(4);
    expect(raw.systemTools).toBe(2);
    expect(raw.mcpTools).toBe(2);
    expect(raw.messages).toBeGreaterThan(4); // 2+2 + toolCall JSON
  });

  it("skills 缺省为 0（并入提示词的调用方语义）", () => {
    const raw = breakdownFromRequest({ ...req, systemSegments: { prompt: "abcd" } });
    expect(raw.skills).toBe(0);
  });
});

describe("calibrate", () => {
  it("恒等式：六类之和 === 真实输入", () => {
    const raw = breakdownFromRequest(req);
    const snap = calibrate(raw, 900, { modelId: "m-1", cachedInputTokens: 300 });
    const sum = Object.values(snap.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(900);
    expect(snap.inputTokens).toBe(900);
    expect(snap.modelId).toBe("m-1");
    expect(snap.cache).toEqual({ inputTokens: 900, cachedInputTokens: 300 });
  });

  it("残差进 other 且不为负；比例缩放保持占比形状", () => {
    const raw = breakdownFromRequest(req);
    const snap = calibrate(raw, 100);
    expect(snap.breakdown.other).toBeGreaterThanOrEqual(0);
    // 五类缩放后总和 ≤ 100
    const five = (Object.values(snap.breakdown) as number[]).slice(0, 5)
      .reduce((a: number, b: number) => a + b, 0) - snap.breakdown.other;
    expect(five).toBeLessThanOrEqual(100);
  });

  it("真实输入为 0 → 六类全 0", () => {
    const raw = breakdownFromRequest(req);
    const snap = calibrate(raw, 0);
    expect(Object.values(snap.breakdown).every((v) => v === 0)).toBe(true);
  });
});
