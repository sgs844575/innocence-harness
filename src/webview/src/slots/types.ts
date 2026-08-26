import type { ComponentType, ReactNode } from "react";

/** 外部工作台面板贡献：注册序即面板清单序。 */
export interface ExternalPanelContribution {
  id: string;
  labelKey: string;
  render: () => ReactNode;
}

/** 外部设置分区贡献：注册序即设置分区清单序。 */
export interface ExternalSettingsContribution {
  id: string;
  labelKey: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  render: () => ReactNode;
}

export type FutureCapabilityId =
  | "editor"
  | "charts"
  | "workflow"
  | "document-preview"
  | "remote-development";

export interface CapabilityMetadata {
  id: FutureCapabilityId;
  slots: readonly string[];
}

/** 单值槽位的一次注册（含注销句柄）；供宿主侧扩展使用。 */
export interface SlotContribution<T> {
  contribution: T;
  unregister(): void;
}

/** 单值槽位：register 返回注销函数；get 读取当前生效值。 */
export interface SingleSlot<T> {
  register(contribution: T): () => void;
  get(): T | undefined;
}

/** 列表槽位：register 返回注销函数；all 返回当前快照（身份稳定）。 */
export interface ListSlot<T> {
  register(contribution: T): () => void;
  all(): readonly T[];
}

/**
 * 键控槽位的一条贡献：
 * - key 为精确名，或形如 "prefix:abc" 的前缀声明（按前缀 "abc" 匹配）；
 * - priority 缺省 0，数值大者优先。
 */
export interface KeyedContribution<T> {
  key: string;
  priority?: number;
  value: T;
}

/** 键控槽位：resolve 按「精确 key → 最长匹配前缀」顺序解析。 */
export interface KeyedSlot<T> {
  register(c: KeyedContribution<T>): () => void;
  resolve(name: string): T | undefined;
}
