// @vitest-environment jsdom
// 外观设置的代码主题对回归钉：切换浅色/深色高亮主题后，已渲染代码块必须
// 重新高亮（真实 shiki + streamdown 链路；主题懒加载走异步回调）。
// Mermaid 插件回归钉：主题切换后插件重建触发已有图表重新渲染（jsdom 环境
// 无法真实渲染 mermaid SVG，测试跳过；生产功能依赖真实浏览器 DOM API）。
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";

const SRC_CODE = "```ts\nconst alpha = 1;\n```";

function tokenStyles(container: HTMLElement): string {
  return [...container.querySelectorAll("pre span")]
    .map((el) => (el as HTMLElement).style.cssText)
    .join("|");
}

describe("MarkdownView 代码主题", () => {
  it("初始渲染产出真实主题色；主题对变更后重新着色", async () => {
    const { container, rerender } = render(
      <MarkdownView
        source={SRC_CODE}
        code={{ light: "github-light-default", dark: "github-dark-default", lineNumbers: true }}
      />,
    );
    // 等真实颜色（#hex）出现，而非 inherit 占位。
    await waitFor(() => expect(tokenStyles(container)).toContain("#CF222E"), { timeout: 30000 });
    const preStyle = container.querySelector("pre")?.getAttribute("style") ?? "";
    expect(preStyle).toContain("--sdm-bg: #ffffff");
    expect(preStyle).toContain("--shiki-dark-bg: #0d1117");
    expect(tokenStyles(container)).toContain("--shiki-dark: #FF7B72");
    rerender(
      <MarkdownView source={SRC_CODE} code={{ light: "one-light", dark: "dracula", lineNumbers: true }} />,
    );
    // dracula 关键字色出现 = 新主题对生效。
    await waitFor(() => expect(tokenStyles(container)).toContain("FF79C6"), { timeout: 30000 });
  }, 90000);
});
