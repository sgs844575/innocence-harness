// 插件渲染层注册面（PluginClientApi）：描述符式与组件式工具卡、工作台面板、
// 设置分区注册均经槽位的 subscribe 通道驱动消费组件重渲染；生命周期由装载器
// 经 dispose 持有（同注册表重装载先撤销旧注册）。
import type { ComponentType } from "react";
import type { SlotRegistry } from "../slots/registry";
import {
  createDescriptorCard,
  type ToolCardDescriptor,
} from "../components/chat/toolcards/DescriptorToolCard";
import type { ToolCardProps } from "../components/chat/toolcards/registry";
import type { ExternalPanelContribution, ExternalSettingsContribution, CapabilityMetadata } from "../slots/types";
import { PANEL_SLOT } from "../components/workbench/WorkbenchTabs";
import { SETTINGS_SECTION_SLOT } from "../components/SettingsNav";

export const CAPABILITY_METADATA_SLOT = "capability.metadata";

/**
 * PluginClientApi：描述符式工具卡与三类组件贡献注册面。
 * 组件贡献的注册方法返回注销句柄；描述符方法保持 v1 的 void 兼容。
 */
export interface PluginClientApi {
  registerToolCard(toolName: string, descriptor: ToolCardDescriptor): void;
  registerToolCardPrefix(prefix: string, descriptor: ToolCardDescriptor): void;
  registerToolCardComponent(contribution: {
    name: string;
    component: ComponentType<ToolCardProps>;
  }): () => void;
  registerCapability(contribution: CapabilityMetadata): () => void;
  registerPanel(contribution: ExternalPanelContribution): () => void;
  registerSettingsSection(section: ExternalSettingsContribution): () => void;
}

/** 工厂产物：api 交 client 模块的 default 注册函数；dispose 撤销该 api
 *  产生的全部注册（重复调用幂等，dispose 后再注册为无害空操作）。 */
export interface PluginClientApiHandle {
  readonly api: PluginClientApi;
  dispose(): void;
}

/** 构造注册面：描述符 → DescriptorToolCard 包装组件 → 键控槽位贡献。 */
export function createPluginClientApi(
  registry: SlotRegistry,
  slotName: string,
): PluginClientApiHandle {
  const toolCardSlot = registry.keyed<ComponentType<ToolCardProps>>(slotName);
  const capabilitySlot = registry.list<CapabilityMetadata>(CAPABILITY_METADATA_SLOT);
  const panelSlot = registry.list<ExternalPanelContribution>(PANEL_SLOT);
  const settingsSectionSlot = registry.list<ExternalSettingsContribution>(SETTINGS_SECTION_SLOT);
  const unregisters: Array<() => void> = [];
  let disposed = false;
  const noop = (): void => {};
  const track = (unregister: () => void): () => void => {
    unregisters.push(unregister);
    return unregister;
  };
  const registerDescriptor = (key: string, descriptor: ToolCardDescriptor): void => {
    if (disposed) return;
    track(toolCardSlot.register({ key, value: createDescriptorCard(descriptor) }));
  };
  const registerComponent = (
    component: ComponentType<ToolCardProps>,
    name: string,
  ): () => void => {
    if (disposed) return noop;
    return track(toolCardSlot.register({ key: name, priority: 100, value: component }));
  };
  const registerCapability = (contribution: CapabilityMetadata): () => void => {
    if (disposed) return noop;
    return track(capabilitySlot.register(contribution));
  };
  const registerPanelContribution = (contribution: ExternalPanelContribution): () => void => {
    if (disposed) return noop;
    return track(panelSlot.register(contribution));
  };
  const registerSettingsContribution = (contribution: ExternalSettingsContribution): () => void => {
    if (disposed) return noop;
    return track(settingsSectionSlot.register(contribution));
  };
  return {
    api: {
      registerToolCard: (toolName, descriptor) => registerDescriptor(toolName, descriptor),
      registerToolCardPrefix: (prefix, descriptor) => registerDescriptor(`prefix:${prefix}`, descriptor),
      registerToolCardComponent: (contribution) => registerComponent(contribution.component, contribution.name),
      registerCapability,
      registerPanel: registerPanelContribution,
      registerSettingsSection: registerSettingsContribution,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of unregisters.splice(0)) off();
    },
  };
}
