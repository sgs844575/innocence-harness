// 内置面板贡献：工作台首页、辅助对话、审查、路线、代码、待办、终端和浏览器注册进
// workbench.panel 槽位。面板 props 来自 App 状态；贡献对象经 useMemo 只构造
// 一次，render 闭包经 ref 读取最新面板内容。
import { useMemo, useRef } from "react";
import { useRegisterList } from "../../slots/react";
import { PANEL_SLOT, type WorkbenchPanelContribution, type WorkbenchTabId } from "./WorkbenchTabs";

/** 单条注册哑组件：每条贡献独立持钩，规避数组循环内调用钩子（T3 范式）。 */
function Registrar({ contribution }: { contribution: WorkbenchPanelContribution }): React.JSX.Element | null {
  useRegisterList(PANEL_SLOT, contribution);
  return null;
}

/** 挂载于 <SlotProvider> 内：四个内置面板按固定序注册；卸载时整体注销。
 *  兄弟顺序约束：必须渲染在消费方（useWorkbenchTabs 页签派生，经
 *  WorkbenchShell/WorkbenchTabs 树）之前，否则首轮派生读到空清单。 */
export function BuiltinPanels({
  panels,
}: {
  panels: Partial<Record<WorkbenchTabId, React.ReactNode>>;
}): React.JSX.Element {
  // latest ref：render 回调读取 props 的传播形态（App 状态变化不触发重注册）。
  const latest = useRef(panels);
  latest.current = panels;
  const contributions = useMemo<readonly WorkbenchPanelContribution[]>(
    () => [
      { id: "home", labelKey: "workbench.tab.home", render: () => latest.current.home },
      { id: "assistant", labelKey: "workbench.tab.assistant", render: () => latest.current.assistant },
      { id: "review", labelKey: "workbench.tab.review", render: () => latest.current.review },
      { id: "routes", labelKey: "workbench.tab.routes", render: () => latest.current.routes },
      { id: "code", labelKey: "workbench.tab.code", render: () => latest.current.code },
      { id: "todo", labelKey: "workbench.tab.todo", render: () => latest.current.todo },
      { id: "terminal", labelKey: "workbench.tab.terminal", render: () => latest.current.terminal },
      { id: "browser", labelKey: "workbench.tab.browser", render: () => latest.current.browser },
    ],
    [],
  );
  return <>{contributions.map((c) => <Registrar key={c.id} contribution={c} />)}</>;
}
