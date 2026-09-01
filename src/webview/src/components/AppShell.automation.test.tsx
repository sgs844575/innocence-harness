// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { AutomationView } from "./AutomationView";
import { SlotProvider } from "../slots/react";
import { createSlotRegistry } from "../slots/registry";

beforeAll(() => {
  window.matchMedia = (() => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(cleanup);

describe("AppShell automation navigation", () => {
  it("opens the presentation-only automation surface through the typed nav", () => {
    render(
      <SlotProvider registry={createSlotRegistry()}>
        <AppShell
          t={(key) => key}
          titleBar={(nav) => <button type="button" onClick={nav.openAutomation}>Open automation</button>}
          sidebar={() => null}
          chat={<div>Chat surface</div>}
          automation={<div>Automation empty state</div>}
          settings={() => null}
          panels={{}}
        />
      </SlotProvider>,
    );
    expect(screen.getByText("Chat surface")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open automation" }));
    expect(screen.getByText("Automation empty state")).toBeTruthy();
    expect(screen.queryByText("Chat surface")).toBeNull();
  });
});

describe("AppShell workbench navigation", () => {
  it("starts the workbench on its home tab", () => {
    render(
      <SlotProvider registry={createSlotRegistry()}>
        <AppShell
          t={(key) => key}
          titleBar={(nav) => <output data-testid="active-workbench-tab">{nav.workbench.tab}</output>}
          sidebar={() => null}
          chat={<div>Chat surface</div>}
          settings={() => null}
          panels={{}}
        />
      </SlotProvider>,
    );
    expect(screen.getByTestId("active-workbench-tab").textContent).toBe("home");
  });
});
describe("AppShell sidebar collapse", () => {
  it("removes the sidebar entirely when collapsed (no rail strip; the title-bar toggle restores it)", () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    render(
      <SlotProvider registry={createSlotRegistry()}>
        <AppShell
          t={(key) => key}
          titleBar={(nav) => <button type="button" onClick={nav.toggleSidebar} aria-label={nav.sidebarOpen ? "折叠侧边栏" : "展开侧边栏"}>toggle</button>}
          sidebar={() => <div data-testid="full-sidebar">Full sidebar</div>}
          chat={<div>Chat surface</div>}
          settings={() => null}
          panels={{}}
        />
      </SlotProvider>,
    );

    expect(screen.getByTestId("full-sidebar")).toBeTruthy();

    // 收起 = 侧边栏整列宽度动画到 0（常驻挂载以便动画，无窄条 rail）
    const chatSurface = screen.getByText("Chat surface");
    const main = chatSurface.closest("main");
    expect(main?.className).toContain("rounded-tl-[12px]");
    expect(main?.className).toContain("rounded-bl-[12px]");

    fireEvent.click(screen.getByRole("button", { name: "折叠侧边栏" }));
    const collapsed = screen.getByTestId("full-sidebar");
    expect(collapsed.parentElement?.className).toContain("w-0");
    expect(main?.className).toContain("rounded-none");
    expect(screen.getByText("Chat surface")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(screen.getByTestId("full-sidebar").parentElement?.className).toContain("w-[265px]");
    expect(main?.className).toContain("rounded-tl-[12px]");
    expect(main?.className).toContain("rounded-bl-[12px]");
  });
});
describe("AppShell global search", () => {
  it("closes the responsive drawer before opening search", () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 640px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    render(
      <SlotProvider registry={createSlotRegistry()}>
        <AppShell
          t={(key) => key}
          titleBar={(nav) => <button type="button" onClick={nav.toggleSidebar} aria-label={nav.sidebarOpen ? "折叠侧边栏" : "展开侧边栏"}>toggle drawer</button>}
          sidebar={(nav) => <button type="button" onClick={nav.openSearch}>Search from drawer</button>}
          chat={<div>Chat surface</div>}
          search={(nav) => nav.searchOpen ? <div role="dialog">Search</div> : null}
          settings={() => null}
          panels={{}}
        />
      </SlotProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(screen.getByRole("button", { name: "Search from drawer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search from drawer" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search from drawer" })).toBeNull();
    // 抽屉已随导航收起——再次展开侧栏后搜索入口可见
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(screen.getByRole("button", { name: "Search from drawer" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("button", { name: "Search from drawer" })).toBeNull();
  });

  it("opens the shell search dialog from both typed navigation and Ctrl/Cmd+K", () => {
    render(
      <SlotProvider registry={createSlotRegistry()}>
        <AppShell
          t={(key) => key}
          titleBar={(nav) => <button type="button" onClick={(nav as typeof nav & { openSearch: () => void }).openSearch}>Open search</button>}
          sidebar={() => null}
          chat={<div>Chat surface</div>}
          automation={null}
          search={(nav) => nav.searchOpen ? <div role="dialog" aria-label="Global search">Global search</div> : null}
          settings={() => null}
          panels={{}}
        />
      </SlotProvider>,
    );

    expect(screen.queryByRole("dialog", { name: /global search/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    expect(screen.getByRole("dialog", { name: /global search/i })).toBeTruthy();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: /global search/i })).toBeTruthy();
  });
});

describe("AutomationView creation flow", () => {
  it("requests, confirms, lists, and manually dispatches a host-generated automation", async () => {
    const candidate = {
      trigger: { kind: "schedule" as const, expression: "0 9 * * 1", everyMs: 604_800_000 },
      actions: [{ kind: "review" as const, command: "Review pending tasks" }],
      constraints: ["ask permission"],
      reviewSummary: "Review pending tasks every Monday.",
    };
    const definition = { id: "automation-1", name: "Weekly review", candidate, enabled: true, createdAt: 1, updatedAt: 1 };
    window.innocencecode = {
      generateAutomationCandidate: vi.fn(async () => candidate),
      confirmAutomation: vi.fn(async () => definition),
      listAutomations: vi.fn(async () => [definition]),
      triggerAutomation: vi.fn(async () => {}),
    } as never;
    render(<AutomationView onBack={() => {}} sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: "新建自动化" }));
    fireEvent.change(screen.getByRole("textbox", { name: "自动化需求" }), { target: { value: "每周审查待办" } });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));
    await screen.findByText("候选方案");
    expect(window.innocencecode.generateAutomationCandidate).toHaveBeenCalledWith("每周审查待办");

    fireEvent.change(screen.getByRole("textbox", { name: "自动化名称" }), { target: { value: "Weekly review" } });
    fireEvent.click(screen.getByRole("button", { name: "提交自动化" }));
    await screen.findByText("Weekly review");
    fireEvent.click(screen.getByRole("button", { name: "立即执行 Weekly review" }));
    await waitFor(() => expect(window.innocencecode.triggerAutomation).toHaveBeenCalledWith({
      id: "automation-1", trigger: "manual", sessionId: "session-1", routeId: "main",
    }));
  });
});
