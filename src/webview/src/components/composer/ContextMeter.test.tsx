// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContextMeter, contextAccentClass, formatTokenCount } from "./ContextMeter";
import type { ChatContextUsageSnapshot } from "../../../../shared/ipc";

afterEach(cleanup);

const t = (key: string) => key;

const base: ChatContextUsageSnapshot = {
  inputTokens: 64_000,
  breakdown: { systemPrompt: 2_240, skills: 0, systemTools: 16_768, mcpTools: 27_776, messages: 9_088, other: 5_248 },
  cache: { inputTokens: 1_000_000, cachedInputTokens: 978_000 },
  contextWindow: 1_000_000,
};

const snap = (over: Partial<ChatContextUsageSnapshot> = {}): ChatContextUsageSnapshot => ({
  ...base,
  ...over,
  breakdown: { ...base.breakdown, ...(over.breakdown ?? {}) },
  cache: { ...base.cache, ...(over.cache ?? {}) },
});

describe("ContextMeter", () => {
  it("渲染触发环，点击后弹层头行按万格式给总量与百分比", async () => {
    render(<ContextMeter t={t} snapshot={snap()} />);
    expect(screen.getByTestId("chat-context-meter")).toBeDefined();
    fireEvent.click(screen.getByTestId("chat-context-meter"));
    expect(await screen.findByText("chat.contextMeter.title")).toBeDefined();
    // 头行：6.4万 / 100万（6.4%）
    expect(screen.getByText("6.4万 / 100万（6.4%）")).toBeDefined();
  });

  it("opens without usage and updates the open panel when usage arrives", async () => {
    const view = render(<ContextMeter t={t} snapshot={null} />);
    fireEvent.click(screen.getByTestId("chat-context-meter"));
    expect(await screen.findByText("chat.contextMeter.unavailable")).toBeDefined();
    view.rerender(<ContextMeter t={t} snapshot={snap()} />);
    expect(screen.queryByText("chat.contextMeter.unavailable")).toBeNull();
    expect(screen.getByText("6.4万 / 100万（6.4%）")).toBeDefined();
    fireEvent.click(screen.getByTestId("chat-context-meter"));
    expect(screen.queryByText("chat.contextMeter.title")).toBeNull();
  });

  it("pct=0 不渲染弧 circle（round 线帽 + 零长虚线会画出圆点）；pct>0 底环+弧", () => {
    const zero = render(<ContextMeter t={t} snapshot={null} />);
    expect(zero.container.querySelectorAll("circle")).toHaveLength(1); // 只有底环
    const filled = render(<ContextMeter t={t} snapshot={snap()} />);
    expect(filled.container.querySelectorAll("circle")).toHaveLength(2); // 底环 + 弧
  });

  it("open=false 不渲染任何内容", () => {
    render(<ContextMeter t={t} snapshot={snap()} open={false} />);
    expect(screen.queryByTestId("chat-context-meter")).toBeNull();
    expect(screen.queryByTestId("context-category-row")).toBeNull();
  });

  it("分类行按占比降序、零值隐藏，缓存命中率页脚", () => {
    render(<ContextMeter t={t} snapshot={snap()} open />);
    const rows = screen.getAllByTestId("context-category-row").map((el) => el.textContent);
    // 降序：mcpTools(27776) > systemTools(16768) > messages(9088) > other(5248) > systemPrompt(2240)
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain("chat.contextMeter.mcpTools");
    expect(rows[1]).toContain("chat.contextMeter.systemTools");
    expect(rows[4]).toContain("chat.contextMeter.systemPrompt");
    // 零值类（skills=0）不渲染
    expect(screen.queryByText("chat.contextMeter.skills")).toBeNull();
    // 页脚：平均缓存命中率 97.8%
    expect(screen.getByText("chat.contextMeter.cacheHitRate")).toBeDefined();
    expect(screen.getByText("97.8%")).toBeDefined();
  });

  it("无缓存数据隐藏缓存行；contextWindow 缺失显示 — 且省略总百分比", () => {
    render(
      <ContextMeter
        t={t}
        snapshot={snap({ cache: { inputTokens: 0, cachedInputTokens: 0 }, contextWindow: undefined })}
        open
      />,
    );
    expect(screen.queryByText("chat.contextMeter.cacheHitRate")).toBeNull();
    // 头行 = 总量 / 「—」分母（总百分比省略）；span 直属文本节点拼接后匹配。
    expect(screen.getByText("6.4万 / —")).toBeDefined();
    expect(screen.queryByText(/（6\.4%）/)).toBeNull();
  });

  it("阈值配色：<60 accent / 60–85 warn / ≥85 err（边界值归属橙/红）", () => {
    expect(contextAccentClass(0.5)).toBe("accent");
    expect(contextAccentClass(0.5999)).toBe("accent");
    expect(contextAccentClass(0.6)).toBe("warn");
    expect(contextAccentClass(0.7)).toBe("warn");
    expect(contextAccentClass(0.8499)).toBe("warn");
    expect(contextAccentClass(0.85)).toBe("err");
    expect(contextAccentClass(0.9)).toBe("err");
  });

  it("数字格式化：亿/万/k/原值，去尾零", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1000)).toBe("1k");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(64_000)).toBe("6.4万");
    expect(formatTokenCount(1_000_000)).toBe("100万");
    expect(formatTokenCount(100_000_000)).toBe("1亿");
    expect(formatTokenCount(240_000_000)).toBe("2.4亿");
  });
});
