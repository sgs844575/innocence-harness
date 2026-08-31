// @vitest-environment jsdom
// TitleBar 最小覆盖：工作台控件走注入的 t（en-US 不再露出中文硬编码）、
// 终端开关带 aria-pressed、gitBranch 未知时 branch chip 整片隐藏（不渲染
// 错误的「非 Git」）、左段 logo 折叠语义与收起态新会话钮。
// 纯 props 驱动，不触 IPC。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TitleBar } from "./TitleBar";

const popupMenu = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../lib/ipc", () => ({ api: { popupMenu } }));

afterEach(() => {
  cleanup();
  popupMenu.mockClear();
});

describe("TitleBar workbench controls", () => {
  it("localizes the editor/panel/terminal controls through the injected t", () => {
    render(
      <TitleBar
        sidebarOpen
        workbench={{ project: "demo", routeId: null, gitBranch: null }}
        onOpenExternalEditor={() => undefined}
        onTogglePanel={() => undefined}
        onToggleTerminal={() => undefined}
        t={(key) => ({ "titlebar.externalEditor": "Open in editor", "titlebar.togglePanel": "Toggle panel", "titlebar.openTerminal": "Open terminal" }[key] ?? key)}
      />,
    );
    expect(screen.getByRole("button", { name: "Open in editor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle panel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open terminal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "在外部编辑器打开" })).toBeNull();
  });

  it("carries aria-pressed state on the panel and terminal toggles", () => {
    render(
      <TitleBar
        sidebarOpen
        panelOpen
        terminalOpen={false}
        onTogglePanel={() => undefined}
        onToggleTerminal={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "切换辅助面板" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "打开终端" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the logo collapse toggle, history stubs, and the collapsed-only new-session shortcut", () => {
    const onToggleSidebar = vi.fn();
    const onNewSession = vi.fn();
    const { rerender } = render(
      <TitleBar sidebarOpen onToggleSidebar={onToggleSidebar} onNewSession={onNewSession} />,
    );
    // logo 即折叠钮（收起后侧栏整体消失，logo 留在标题栏）
    const collapse = screen.getByRole("button", { name: "折叠侧边栏" });
    expect(collapse.querySelector("img[src*='polyline']")).toBeTruthy();
    expect(collapse.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(collapse);
    expect(onToggleSidebar).toHaveBeenCalledOnce();
    // 展开态：无新会话钮（侧栏菜单已有同项）；前后为禁用存根
    expect(screen.queryByRole("button", { name: "新会话" })).toBeNull();
    expect((screen.getByRole("button", { name: "后退" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "前进" }) as HTMLButtonElement).disabled).toBe(true);

    // 收起态：新会话钮出现在箭头之后
    rerender(<TitleBar sidebarOpen={false} onToggleSidebar={onToggleSidebar} onNewSession={onNewSession} />);
    fireEvent.click(screen.getByRole("button", { name: "新会话" }));
    expect(onNewSession).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(onToggleSidebar).toHaveBeenCalledTimes(2);
  });

  it("renders the logo as a static chip when no collapse handler is wired", () => {
    const { container } = render(<TitleBar sidebarOpen />);
    expect(screen.queryByRole("button", { name: "折叠侧边栏" })).toBeNull();
    expect(container.querySelector("img[src*='polyline']")).toBeTruthy();
  });

  it("replaces text menus with an ArrowDown panel and dispatches the selected menu", () => {
    render(<TitleBar sidebarOpen />);
    expect(screen.queryByRole("button", { name: "文件" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "打开菜单" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu").id).toBe(panelId);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["文件", "编辑", "视图", "帮助"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    expect(popupMenu).toHaveBeenCalledWith("view");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("uses titlebar menu copy and labels from the injected translator", () => {
    render(
      <TitleBar
        sidebarOpen
        t={(key) => ({
          "titlebar.menu.open": "Open menu",
          "titlebar.menu.label": "Application menu",
          "titlebar.menu.file": "File menu",
          "titlebar.menu.edit": "Edit menu",
          "titlebar.menu.view": "View menu",
          "titlebar.menu.help": "Help menu",
        }[key] ?? key)}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Application menu" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["File menu", "Edit menu", "View menu", "Help menu"]);
  });

  it("closes the menu with Escape and an outside pointer event", () => {
    render(<TitleBar sidebarOpen />);
    const trigger = screen.getByRole("button", { name: "打开菜单" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("uses the panel toggle to close an open terminal and openTerminal otherwise", () => {
    const closePanel = vi.fn();
    const openTerminal = vi.fn();
    const { rerender } = render(
      <TitleBar sidebarOpen terminalOpen onTogglePanel={closePanel} onToggleTerminal={openTerminal} />,
    );
    const openTerminalButton = screen.getByRole("button", { name: "关闭终端" });
    expect(openTerminalButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(openTerminalButton);
    expect(closePanel).toHaveBeenCalledTimes(1);
    expect(openTerminal).not.toHaveBeenCalled();

    rerender(
      <TitleBar sidebarOpen terminalOpen={false} onTogglePanel={closePanel} onToggleTerminal={openTerminal} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开终端" }));
    expect(openTerminal).toHaveBeenCalledTimes(1);
  });

  it("hides the git branch chip while the branch is unknown (no wrong 非 Git)", () => {
    render(<TitleBar sidebarOpen workbench={{ project: "demo", routeId: null, gitBranch: null }} />);
    expect(screen.queryByText("非 Git")).toBeNull();
    expect(screen.getByText("demo")).toBeTruthy();
  });

  it("shows the branch chip when a branch is known", () => {
    render(<TitleBar sidebarOpen workbench={{ project: "demo", routeId: "route_x", gitBranch: "main" }} />);
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("route_x")).toBeTruthy();
  });

  it("disables the external editor entry when no handler is wired", () => {
    render(<TitleBar sidebarOpen />);
    const editor = screen.getByRole("button", { name: "在外部编辑器打开" }) as HTMLButtonElement;
    expect(editor.disabled).toBe(true);
  });
});
