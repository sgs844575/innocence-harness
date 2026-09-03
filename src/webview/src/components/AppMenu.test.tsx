// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppMenu } from "./AppMenu";

afterEach(cleanup);

const t = (key: string) => key;

/** Radix DropdownMenu 的 Trigger 在 pointerdown（左键）时开合，不是 click。 */
function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "titlebar.appMenu.open" }), { button: 0, ctrlKey: false });
}

function renderMenu(overrides: Partial<Parameters<typeof AppMenu>[0]> = {}) {
  const props = {
    t,
    version: "1.2.3",
    workspaceRoot: "D:/proj",
    onNewTask: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onFeedback: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  render(<AppMenu {...props} />);
  openMenu();
  return props;
}

describe("AppMenu", () => {
  it("打开后渲染全部入口（含禁用项）", () => {
    renderMenu();
    for (const key of [
      "sidebar.nav.newChat",
      "titlebar.appMenu.openWorkspace",
      "titlebar.menu.openExplorer",
      "titlebar.appMenu.about",
      "titlebar.appMenu.checkUpdates",
      "titlebar.appMenu.processMonitor",
      "titlebar.menu.feedback",
      "titlebar.appMenu.featureRequest",
      "titlebar.appMenu.community",
      "titlebar.appMenu.docs",
      "titlebar.appMenu.exportLogs",
      "titlebar.appMenu.closeWindow",
    ]) {
      expect(screen.getByText(key)).toBeTruthy();
    }
    // 快捷键提示（非 mac 平台缺省 Ctrl+）。
    expect(screen.getByText("Ctrl+N")).toBeTruthy();
    expect(screen.getByText("Ctrl+O")).toBeTruthy();
  });

  it("新建任务/打开工作区触发对应回调", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByText("sidebar.nav.newChat"));
    expect(props.onNewTask).toHaveBeenCalledTimes(1);
    openMenu();
    fireEvent.click(screen.getByText("titlebar.appMenu.openWorkspace"));
    expect(props.onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("无工作区时「在资源管理器中打开」禁用并带原因；禁用项点击不触发", () => {
    const props = renderMenu({ workspaceRoot: "" });
    const reveal = screen.getByText("titlebar.menu.openExplorer").closest("[data-disabled]");
    expect(reveal).toBeTruthy();
    expect(reveal?.getAttribute("aria-description")).toBe("titlebar.appMenu.noWorkspace");
    const checkUpdates = screen.getByText("titlebar.appMenu.checkUpdates").closest("[data-disabled]");
    expect(checkUpdates?.getAttribute("aria-description")).toBe("titlebar.menu.comingSoon");
    fireEvent.click(screen.getByText("titlebar.menu.openExplorer"));
    expect(props.onNewTask).not.toHaveBeenCalled();
  });

  it("「关于」打开关于对话框（portal 到 body），Esc 关闭", () => {
    renderMenu();
    fireEvent.click(screen.getByText("titlebar.appMenu.about"));
    expect(screen.getByRole("dialog", { name: "titlebar.appMenu.about" })).toBeTruthy();
    expect(screen.getByText("app.name")).toBeTruthy();
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "titlebar.appMenu.about" })).toBeNull();
  });

  it("「进程监视器」打开监视对话框", () => {
    renderMenu();
    fireEvent.click(screen.getByText("titlebar.appMenu.processMonitor"));
    expect(screen.getByRole("dialog", { name: "titlebar.appMenu.processMonitor" })).toBeTruthy();
  });
});
