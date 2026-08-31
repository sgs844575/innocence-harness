// @vitest-environment jsdom
// TitleBar 最小覆盖：工作台控件走注入的 t
//（en-US 不再露出中文硬编码）、终端开关带 aria-pressed、gitBranch 未知时
// branch chip 整片隐藏（不渲染错误的「非 Git」）。纯 props 驱动，不触 IPC。
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
        panelOpen
        terminalOpen={false}
        onTogglePanel={() => undefined}
        onToggleTerminal={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "切换辅助面板" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "打开终端" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("replaces text menus with an ArrowDown panel and dispatches the selected menu", () => {
    render(<TitleBar />);
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
    render(<TitleBar />);
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
      <TitleBar terminalOpen onTogglePanel={closePanel} onToggleTerminal={openTerminal} />,
    );
    const openTerminalButton = screen.getByRole("button", { name: "关闭终端" });
    expect(openTerminalButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(openTerminalButton);
    expect(closePanel).toHaveBeenCalledTimes(1);
    expect(openTerminal).not.toHaveBeenCalled();

    rerender(
      <TitleBar terminalOpen={false} onTogglePanel={closePanel} onToggleTerminal={openTerminal} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开终端" }));
    expect(openTerminal).toHaveBeenCalledTimes(1);
  });

  it("keeps the sidebar toggle out of the title bar (it lives on the sidebar top)", () => {
    render(<TitleBar />);
    expect(screen.queryByRole("button", { name: "折叠侧边栏" })).toBeNull();
    expect(screen.queryByRole("button", { name: "后退" })).toBeNull();
    expect(screen.queryByRole("button", { name: "前进" })).toBeNull();
  });

  it("hides the git branch chip while the branch is unknown (no wrong 非 Git)", () => {
    render(<TitleBar workbench={{ project: "demo", routeId: null, gitBranch: null }} />);
    expect(screen.queryByText("非 Git")).toBeNull();
    expect(screen.getByText("demo")).toBeTruthy();
  });

  it("shows the branch chip when a branch is known", () => {
    render(<TitleBar workbench={{ project: "demo", routeId: "route_x", gitBranch: "main" }} />);
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("route_x")).toBeTruthy();
  });

  it("disables the external editor entry when no handler is wired", () => {
    render(<TitleBar />);
    const editor = screen.getByRole("button", { name: "在外部编辑器打开" }) as HTMLButtonElement;
    expect(editor.disabled).toBe(true);
  });
});
