// @vitest-environment jsdom
// PluginClientApi：描述符与组件式贡献注册面 + 生命周期
// （dispose 撤销该 api 的全部注册；keyed 后注胜语义经 api 透传）。
import { describe, expect, it } from "vitest";
import { createSlotRegistry } from "../slots/registry";
import type { ExternalPanelContribution, ExternalSettingsContribution } from "../slots/types";
import { TOOLCARD_SLOT, type ToolCardProps } from "../components/chat/toolcards/registry";
import type { ComponentType } from "react";
import { createPluginClientApi } from "./api";

describe("createPluginClientApi（描述符注册转槽位）", () => {
  it("registerToolCard：描述符注册为精确 key 的槽位值，可 resolve 到包装组件", () => {
    const registry = createSlotRegistry();
    const { api } = createPluginClientApi(registry, TOOLCARD_SLOT);
    api.registerToolCard("example", { title: "示例插件卡" });
    const card = registry.keyed<ComponentType<ToolCardProps>>(TOOLCARD_SLOT).resolve("example");
    expect(card).toBeDefined();
    expect(typeof card).toBe("function");
    // 精确 key：其它名字不命中
    expect(registry.keyed<ComponentType<ToolCardProps>>(TOOLCARD_SLOT).resolve("other")).toBeUndefined();
  });

  it("registerToolCardPrefix：注册为 prefix: 声明条目，按前缀解析", () => {
    const registry = createSlotRegistry();
    const { api } = createPluginClientApi(registry, TOOLCARD_SLOT);
    api.registerToolCardPrefix("demo__", { title: "前缀卡" });
    const slot = registry.keyed<ComponentType<ToolCardProps>>(TOOLCARD_SLOT);
    expect(slot.resolve("demo__probe")).toBeDefined();
    expect(slot.resolve("demo__other__thing")).toBeDefined();
    expect(slot.resolve("example")).toBeUndefined();
  });

  it("同名后注胜，撤销后注回落先注（keyed 语义透传）", () => {
    const registry = createSlotRegistry();
    const { api } = createPluginClientApi(registry, TOOLCARD_SLOT);
    api.registerToolCard("example", { title: "第一版" });
    const first = registry.keyed<ComponentType<ToolCardProps>>(TOOLCARD_SLOT).resolve("example");
    api.registerToolCard("example", { title: "第二版" });
    const second = registry.keyed<ComponentType<ToolCardProps>>(TOOLCARD_SLOT).resolve("example");
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("dispose 撤销该 api 的全部注册（精确与前缀一并清除，重复调用无害）", () => {
    const registry = createSlotRegistry();
    const handle = createPluginClientApi(registry, TOOLCARD_SLOT);
    handle.api.registerToolCard("example", { title: "示例插件卡" });
    handle.api.registerToolCardPrefix("demo__", { title: "前缀卡" });
    const slot = registry.keyed<ComponentType<ToolCardProps>>(TOOLCARD_SLOT);
    expect(slot.resolve("example")).toBeDefined();
    handle.dispose();
    expect(slot.resolve("example")).toBeUndefined();
    expect(slot.resolve("demo__probe")).toBeUndefined();
    expect(() => handle.dispose()).not.toThrow();
  });

  it("dispose 后的 api 再注册为无害空操作（过期装载回合不得遗留注册）", () => {
    const registry = createSlotRegistry();
    const handle = createPluginClientApi(registry, TOOLCARD_SLOT);
    handle.dispose();
    handle.api.registerToolCard("example", { title: "示例插件卡" });
    expect(
      registry.keyed<ComponentType<ToolCardProps>>(TOOLCARD_SLOT).resolve("example"),
    ).toBeUndefined();
  });

  it("registerToolCardComponent：组件按名称注册到 toolcard 槽位并返回注销句柄", () => {
    const registry = createSlotRegistry();
    const handle = createPluginClientApi(registry, TOOLCARD_SLOT);
    const Card: ComponentType<ToolCardProps> = () => null;

    const off = handle.api.registerToolCardComponent("component-card", Card);

    expect(registry.keyed<ComponentType<ToolCardProps>>("toolcard").resolve("component-card")).toBe(Card);
    expect(typeof off).toBe("function");
    off();
    expect(registry.keyed<ComponentType<ToolCardProps>>("toolcard").resolve("component-card")).toBeUndefined();
  });

  it("registerPanel：贡献按注册序进入 panel 槽位", () => {
    const registry = createSlotRegistry();
    const { api } = createPluginClientApi(registry, TOOLCARD_SLOT);
    const contribution: ExternalPanelContribution = {
      id: "external-panel",
      labelKey: "panel.external",
      render: () => "panel",
    };

    const off = api.registerPanel(
      contribution.id,
      contribution.labelKey,
      contribution.render,
    );

    expect(registry.list<ExternalPanelContribution>("panel").all()).toEqual([contribution]);
    expect(typeof off).toBe("function");
    off();
    expect(registry.list<ExternalPanelContribution>("panel").all()).toEqual([]);
  });

  it("registerSettingsSection：贡献按注册序进入 settings.section 槽位", () => {
    const registry = createSlotRegistry();
    const { api } = createPluginClientApi(registry, TOOLCARD_SLOT);
    const Icon: ComponentType = () => null;
    const contribution: ExternalSettingsContribution = {
      id: "external-settings",
      labelKey: "settings.external",
      icon: Icon,
      render: () => "settings",
    };

    const off = api.registerSettingsSection(
      contribution.id,
      contribution.labelKey,
      contribution.icon,
      contribution.render,
    );

    expect(registry.list<ExternalSettingsContribution>("settings.section").all()).toEqual([contribution]);
    expect(typeof off).toBe("function");
    off();
    expect(registry.list<ExternalSettingsContribution>("settings.section").all()).toEqual([]);
  });

  it("dispose：一次撤销三类贡献，dispose 后注册保持无害", () => {
    const registry = createSlotRegistry();
    const handle = createPluginClientApi(registry, TOOLCARD_SLOT);
    const Card: ComponentType<ToolCardProps> = () => null;
    const Icon: ComponentType = () => null;

    handle.api.registerToolCardComponent("component-card", Card);
    handle.api.registerPanel("panel", "panel", () => null);
    handle.api.registerSettingsSection("settings", "settings", Icon, () => null);
    handle.dispose();

    expect(registry.keyed<ComponentType<ToolCardProps>>("toolcard").resolve("component-card")).toBeUndefined();
    expect(registry.list<ExternalPanelContribution>("panel").all()).toEqual([]);
    expect(registry.list<ExternalSettingsContribution>("settings.section").all()).toEqual([]);
    expect(() => handle.dispose()).not.toThrow();
    expect(() => handle.api.registerPanel("late", "late", () => null)).not.toThrow();
    expect(registry.list<ExternalPanelContribution>("panel").all()).toEqual([]);
  });

});
