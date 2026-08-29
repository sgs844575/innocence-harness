// 字典完整性：zh/en 键集必须一致（缺键静默回落英文会造成半翻译 UI）。
import { describe, expect, it } from "vitest";
import { createT, enUS, zhCN } from "./i18n";

describe("i18n dictionaries", () => {
  it("zh/en 键集完全一致", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
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

  it("agent 模式键成对存在：每个内建模式 id 的 label 与 desc 键在 zh/en 都非空", () => {
    // 批次 4D 任务 3：auto 模式插件的 i18n 键存在性（label+desc zh/en 成对）；
    // 批次 4E 任务 2：coordinator 并入。锁定全部八个内建模式 id，缺一即红
    // （模式插件登记与切换器投影的契约）。
    for (const id of ["default", "creation", "plan", "focus", "minimal", "learning", "auto", "coordinator"]) {
      for (const suffix of ["", ".desc"]) {
        const key = `agentMode.${id}${suffix}`;
        expect(typeof zhCN[key], `zh 缺键 ${key}`).toBe("string");
        expect(zhCN[key].length, `zh 空值 ${key}`).toBeGreaterThan(0);
        expect(typeof enUS[key], `en 缺键 ${key}`).toBe("string");
        expect(enUS[key].length, `en 空值 ${key}`).toBeGreaterThan(0);
      }
    }
    expect(enUS["agentMode.auto"]).toBe("Auto");
    expect(enUS["agentMode.auto.desc"]).not.toMatch(/[\u4e00-\u9fff]/);
    expect(enUS["agentMode.coordinator"]).toBe("Coordinator");
    expect(enUS["agentMode.coordinator.desc"]).not.toMatch(/[\u4e00-\u9fff]/);
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
