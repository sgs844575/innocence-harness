// 字典完整性：zh/en 键集必须一致（缺键静默回落英文会造成半翻译 UI）；
// agent=plan 与权限模式 plan 的语义区分文案必须成对存在（spec 2.2）。
import { describe, expect, it } from "vitest";
import { createT, enUS, zhCN } from "./i18n";

describe("i18n dictionaries", () => {
  it("zh/en 键集完全一致", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("agent.plan 保持显示名“计划”，且与权限模式 plan 的描述措辞区分", () => {
    expect(zhCN["agent.plan"]).toBe("计划");
    expect(zhCN["agent.plan.desc"]).toContain("提示词级");
    expect(zhCN["agent.plan.desc"]).not.toBe(zhCN["permission.mode.plan.desc"]);
    expect(enUS["agent.plan.desc"]).not.toBe(enUS["permission.mode.plan.desc"]);
  });

  it("titlebar menu English copy has unique non-Chinese entries", () => {
    const keys = Object.keys(enUS).filter((key) => key.startsWith("titlebar.menu."));
    expect(keys).toEqual([
      "titlebar.menu.open",
      "titlebar.menu.label",
      "titlebar.menu.file",
      "titlebar.menu.edit",
      "titlebar.menu.view",
      "titlebar.menu.help",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.map((key) => enUS[key]).join(" ")).not.toMatch(/[\u4e00-\u9fff]/);
    expect(keys.map((key) => enUS[key])).toEqual(["Open menu", "Application menu", "File", "Edit", "View", "Help"]);
  });

  it("provides complete English workbench copy without Chinese fallbacks", () => {
    const keys = [
      "workbench.tab.home",
      "workbench.tab.assistant",
      "workbench.tab.todo",
      "workbench.tab.browser",
      "workbench.home.title",
      "workbench.home.description",
      "workbench.home.assistant",
      "workbench.home.review",
      "workbench.home.terminal",
      "workbench.home.browser",
      "workbench.placeholder.todo",
      "workbench.placeholder.browser",
    ];
    expect(keys.every((key) => typeof enUS[key] === "string" && enUS[key].length > 0)).toBe(true);
    expect(keys.map((key) => enUS[key]).join(" ")).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("localizes the workbench placeholder copy in both dictionaries", () => {
    expect(zhCN["workbench.placeholder.todo"]).toBe("待办能力暂不可用");
    expect(zhCN["workbench.placeholder.browser"]).toBe("浏览器能力暂不可用");
    expect(enUS["workbench.placeholder.todo"]).toBe("Todo capability is not available yet");
    expect(enUS["workbench.placeholder.browser"]).toBe("Browser capability is not available yet");
  });

  it("产品名称和关于菜单文案统一为 InnocenceHarness", () => {
    expect(createT("en-US")("app.name")).toBe("InnocenceHarness");
    expect(createT("en-US")("menu.help.about")).toContain("InnocenceHarness");
    expect(createT("zh-CN")("menu.help.about")).toContain("InnocenceHarness");
  });
});
