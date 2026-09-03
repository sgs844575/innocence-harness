// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../../shared/ipc";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

const t = (key: string) => key;

const sessions: Session[] = [
  { id: "s1", title: "重构页面", createdAt: 0, updatedAt: 200, messageCount: 3, workspaceRoot: "D:/alpha" },
  { id: "s2", title: "修 bug", createdAt: 0, updatedAt: 100, messageCount: 1, workspaceRoot: "" },
];

function renderSidebar(extra: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return render(
    <Sidebar
      t={t}
      sessions={sessions}
      activeId={null}
      archived={{}}
      onSelect={() => {}}
      onNew={() => {}}
      onDelete={() => {}}
      onArchive={() => {}}
      onRestore={() => {}}
      onOpenSettings={() => {}}
      onSearch={() => {}}
      onAutomation={() => {}}
      onPlugins={() => {}}
      {...extra}
    />,
  );
}

describe("Sidebar", () => {
  it("菜单块四项与快捷键注记", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /sidebar.nav.newChat/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sidebar.nav.search/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sidebar.nav.automation/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sidebar.nav.plugins/ })).toBeTruthy();
    expect(screen.getByText("Ctrl+N")).toBeTruthy();
  });

  it("项目树按项目分组，点击会话选中", () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect, activeId: "s1" });
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("sidebar.noProject")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /修 bug/ }));
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("筛选钮弹出视图/排序面板，时间线视图扁平列出会话", () => {
    renderSidebar();
    // 项目树默认渲染项目分节
    expect(screen.getByText("alpha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sidebar.filter" }));
    expect(screen.getByRole("button", { name: /sidebar.view.tree/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sidebar.sort.updated/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /sidebar.view.timeline/ }));
    // 时间线：无项目分节头，会话平铺
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByRole("button", { name: /重构页面/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /修 bug/ })).toBeTruthy();
  });

  it("底部用户行与设置入口", () => {
    const onOpenSettings = vi.fn();
    renderSidebar({ onOpenSettings });
    expect(screen.getByText("user.you")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sidebar.settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("分组视图列出持久分组，未分组会话平铺无节头", () => {
    renderSidebar({ groups: [{ id: "g1", name: "评审", collapsed: false, sessionIds: ["s1"] }] });
    fireEvent.click(screen.getByRole("button", { name: "sidebar.groups" }));
    expect(screen.getByText("评审")).toBeTruthy();
    // 组内成员与未分组会话都直接列出（未分组无「sidebar.ungrouped」节头）。
    expect(screen.getByRole("button", { name: /重构页面/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /修 bug/ })).toBeTruthy();
    expect(screen.queryByText("sidebar.ungrouped")).toBeNull();
  });

  it("收起全部 ⇄ 展开全部", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: /重构页面/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sidebar.collapseAll" }));
    expect(screen.queryByRole("button", { name: /重构页面/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /修 bug/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "sidebar.expandAll" }));
    expect(screen.getByRole("button", { name: /重构页面/ })).toBeTruthy();
  });

  it("归档图标把内容区整切为归档列表（标题+项目+恢复/删除）", () => {
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    renderSidebar({ archived: { s1: true }, onRestore, onDelete });
    fireEvent.click(screen.getByRole("button", { name: "sidebar.archived" }));
    // 常规会话树消失（修 bug 不在归档里，也不再显示）；归档行带项目名与操作。
    expect(screen.queryByRole("button", { name: /修 bug/ })).toBeNull();
    expect(screen.getByRole("button", { name: "重构页面" })).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sidebar.restore" }));
    expect(onRestore).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByRole("button", { name: "sidebar.delete" }));
    expect(onDelete).toHaveBeenCalledWith("s1");
    // 再点归档图标返回常规视图。
    fireEvent.click(screen.getByRole("button", { name: "sidebar.archived" }));
    expect(screen.getByRole("button", { name: /修 bug/ })).toBeTruthy();
  });

  it("项目行悬停动作：… 菜单 / 文件树 / 新建任务；任务组不渲染", () => {
    const onNewTaskInProject = vi.fn();
    const onRevealProject = vi.fn();
    const onOpenProjectFile = vi.fn();
    renderSidebar({ onNewTaskInProject, onRevealProject, onOpenProjectFile });
    // 仅真实项目根（D:/alpha）有动作钮，任务组（无根）没有。
    expect(screen.getAllByRole("button", { name: "sidebar.project.newTask" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "sidebar.project.newTask" }));
    expect(onNewTaskInProject).toHaveBeenCalledWith("D:/alpha");
    // … 菜单（Radix 触发器 pointerdown 打开）：在资源管理器中打开回传项目根。
    fireEvent.pointerDown(screen.getByRole("button", { name: "sidebar.project.menu" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByText("titlebar.menu.openExplorer"));
    expect(onRevealProject).toHaveBeenCalledWith("D:/alpha");
    // 文件树：进入后内容区整切为 FileExplorer（返回任务顶行）。
    fireEvent.click(screen.getByRole("button", { name: "sidebar.project.files" }));
    expect(screen.getByRole("button", { name: /sidebar.files.back/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /重构页面/ })).toBeNull();
  });

  it("项目树外包「项目/任务」顶层分组，+ 钮分别新建项目/新会话", () => {
    const onNew = vi.fn();
    const onNewProject = vi.fn();
    renderSidebar({ onNew, onNewProject });
    // 两个分组头：项目（含 alpha 分节）与任务（含无项目会话）。
    expect(screen.getByText("sidebar.group.projects")).toBeTruthy();
    expect(screen.getByText("sidebar.noProject")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sidebar.group.newSession" }));
    expect(onNew).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "sidebar.group.newProject" }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it("分组头折叠隐藏整组内容", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /sidebar.collapse sidebar.noProject/ }));
    expect(screen.queryByRole("button", { name: /修 bug/ })).toBeNull();
    // 项目组不受影响
    expect(screen.getByRole("button", { name: /重构页面/ })).toBeTruthy();
  });

  it("拖拽手柄上下调整分组顺序", () => {
    renderSidebar();
    const projectsHeader = screen.getByText("sidebar.group.projects");
    const tasksHeader = screen.getByText("sidebar.noProject");
    // 初始：项目在前，任务在后。
    expect(projectsHeader.compareDocumentPosition(tasksHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const tasksRow = tasksHeader.parentElement as HTMLElement;
    const grip = tasksRow.querySelector("button[draggable]") as HTMLElement;
    const projectsRow = projectsHeader.parentElement as HTMLElement;
    fireEvent.dragStart(grip);
    // 拖动中：被拖分组行半透明；悬到目标行出现 accent 落点指示线。
    expect(tasksRow.className).toContain("opacity-40");
    fireEvent.dragOver(projectsRow);
    expect(projectsRow.querySelector(".drop-indicator")).toBeTruthy();
    fireEvent.drop(projectsRow);
    // 调整后：任务在前，项目在后；拖动结束指示线消失。
    expect(projectsRow.querySelector(".drop-indicator")).toBeNull();
    expect(
      screen.getByText("sidebar.noProject").compareDocumentPosition(screen.getByText("sidebar.group.projects")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("分组视图隐藏收起全部/筛选（仅保留 # 与归档）", () => {
    renderSidebar({
      groupActions: { createGroup: vi.fn(), moveSession: vi.fn(), moveToTop: vi.fn(), newSessionInGroup: vi.fn(), deleteGroup: vi.fn() },
    });
    // 项目视图（默认）：两钮在。
    expect(screen.getByRole("button", { name: "sidebar.collapseAll" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "sidebar.filter" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sidebar.groups" }));
    // 分组视图：两钮移除，新建分组与归档保留。
    expect(screen.queryByRole("button", { name: "sidebar.collapseAll" })).toBeNull();
    expect(screen.queryByRole("button", { name: "sidebar.filter" })).toBeNull();
    expect(screen.getByRole("button", { name: "sidebar.group.create" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "sidebar.archived" })).toBeTruthy();
  });

  it("分组视图：「#」弹窗新建分组（命名 + 选色）", () => {
    const createGroup = vi.fn();
    renderSidebar({
      groupActions: { createGroup, moveSession: vi.fn(), moveToTop: vi.fn(), newSessionInGroup: vi.fn(), deleteGroup: vi.fn() },
    });
    fireEvent.click(screen.getByRole("button", { name: "sidebar.groups" }));
    fireEvent.click(screen.getByRole("button", { name: "sidebar.group.create" }));
    // 弹窗：名称输入 + 七色；选红色后提交。
    fireEvent.change(screen.getByLabelText("sidebar.group.namePlaceholder"), { target: { value: "前端组" } });
    fireEvent.click(screen.getByRole("button", { name: /sidebar.group.color.red/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "sidebar.group.create" })[1]!);
    expect(createGroup).toHaveBeenCalledWith("前端组", "red");
  });

  it("分组内行悬停动作：移动到顶部 / 移出分组；空分组虚线提示可点新建", () => {
    const moveToTop = vi.fn();
    const moveSession = vi.fn();
    const newSessionInGroup = vi.fn();
    const deleteGroup = vi.fn();
    renderSidebar({
      groups: [
        { id: "g1", name: "评审", collapsed: false, sessionIds: ["s1"] },
        { id: "g2", name: "空组", collapsed: false, sessionIds: [] },
      ],
      groupActions: { createGroup: vi.fn(), moveSession, moveToTop, newSessionInGroup, deleteGroup },
    });
    fireEvent.click(screen.getByRole("button", { name: "sidebar.groups" }));
    fireEvent.click(screen.getByRole("button", { name: "sidebar.group.moveToTop" }));
    expect(moveToTop).toHaveBeenCalledWith("g1", "s1");
    fireEvent.click(screen.getByRole("button", { name: "sidebar.group.remove" }));
    expect(moveSession).toHaveBeenCalledWith("s1", null);
    // 空分组：虚线提示「新建任务，或拖拽到这里。」点击 = 组内新建。
    fireEvent.click(screen.getByRole("button", { name: "sidebar.group.empty" }));
    expect(newSessionInGroup).toHaveBeenCalledWith("g2");
    // 分组头悬停动作：⊕新建会话 / 删除分组（无数量统计显示）。
    fireEvent.click(screen.getAllByRole("button", { name: "sidebar.group.newSession" })[0]!);
    expect(newSessionInGroup).toHaveBeenCalledWith("g1");
    fireEvent.click(screen.getAllByRole("button", { name: "sidebar.group.delete" })[0]!);
    expect(deleteGroup).toHaveBeenCalledWith("g1");
    expect(screen.getByText("评审").parentElement?.textContent).not.toMatch(/评审\s*1/);
  });

  it("拖拽未分组会话到分组节 → moveSession 入组", () => {
    const moveSession = vi.fn();
    renderSidebar({
      groups: [{ id: "g1", name: "评审", collapsed: false, sessionIds: ["s1"] }],
      groupActions: { createGroup: vi.fn(), moveSession, moveToTop: vi.fn(), newSessionInGroup: vi.fn(), deleteGroup: vi.fn() },
    });
    fireEvent.click(screen.getByRole("button", { name: "sidebar.groups" }));
    const sourceRow = screen.getByRole("button", { name: /修 bug/ }).closest("li")!;
    const targetSection = screen.getByText("评审").closest("section")!;
    const dataTransfer = {
      store: "",
      setData(_type: string, value: string) { this.store = value; },
      getData() { return this.store; },
      types: ["text/plain"],
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(sourceRow, { dataTransfer });
    fireEvent.dragOver(targetSection, { dataTransfer });
    fireEvent.drop(targetSection, { dataTransfer });
    expect(moveSession).toHaveBeenCalledWith("s2", "g1");
  });
});
