// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../../../shared/ipc";
import type { SidebarStateController } from "../../state/useSidebarState";
import logoUrl from "../../../../../logo.svg";
import { NavRail } from "../NavRail";
import { Sidebar } from "../Sidebar";

const sessions: Session[] = [
  { id: "active", title: "Active", createdAt: 1, updatedAt: 1, messageCount: 0, workspaceRoot: "" },
  { id: "archived", title: "Archived", createdAt: 2, updatedAt: 2, messageCount: 0, workspaceRoot: "" },
];

function controller(): SidebarStateController {
  return {
    state: {
      version: 1,
      order: ["active", "archived"],
      archived: { active: false, archived: true },
      groups: [],
      ungrouped: ["active", "archived"],
      projectOrder: [],
      manualProjectOrders: {},
      manualUngrouped: false,
      projects: [],
    },
    archiveSession: vi.fn(async () => {}),
    reorderSessions: vi.fn(async () => {}),
    moveSession: vi.fn(async () => {}),
    reorderContainers: vi.fn(async () => {}),
    upsertSidebarGroup: vi.fn(async () => {}),
    deleteSidebarGroup: vi.fn(async () => {}),
    setSidebarGroupCollapsed: vi.fn(async () => {}),
  };
}

const t = (key: string) => key;

afterEach(cleanup);

describe("Sidebar archive and session statuses", () => {
  it("loads the repository logo asset in the expanded sidebar", () => {
    render(<Sidebar t={t} appName="InnocenceHarness" sessions={sessions} activeId={null} sidebar={controller()} onSelect={() => {}} onNew={() => {}} onDelete={() => {}} onArchive={() => {}} onOpenSettings={() => {}} />);
    const logo = screen.getByRole("img", { name: "InnocenceHarness Logo" });
    expect(decodeURIComponent(logo.getAttribute("src") ?? "")).toContain("polyline points='38,42 62,64 38,86'");
  });

  it("routes compact navigation actions through injected commands", () => {
    const onNew = vi.fn();
    const onSearch = vi.fn();
    const onAutomation = vi.fn();
    const onPlugins = vi.fn();
    render(<Sidebar t={t} appName="App" sessions={sessions} activeId={null} sidebar={controller()} onSelect={() => {}} onNew={onNew} onDelete={() => {}} onArchive={() => {}} onOpenSettings={() => {}} onSearch={onSearch} onAutomation={onAutomation} onPlugins={onPlugins} />);
    fireEvent.click(screen.getByRole("button", { name: "sidebar.nav.newChat" }));
    fireEvent.click(screen.getByRole("button", { name: "sidebar.nav.search" }));
    fireEvent.click(screen.getByRole("button", { name: "sidebar.nav.automation" }));
    fireEvent.click(screen.getByRole("button", { name: "sidebar.nav.plugins" }));
    expect(onNew).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onAutomation).toHaveBeenCalledOnce();
    expect(onPlugins).toHaveBeenCalledOnce();
  });

  it("creates a named group through the id-only sidebar command", () => {
    const sidebar = controller();
    render(<Sidebar t={t} appName="App" sessions={sessions} activeId={null} sidebar={sidebar} onSelect={() => {}} onNew={() => {}} onDelete={() => {}} onArchive={() => {}} onOpenSettings={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "sidebar.groups" }));
    fireEvent.click(screen.getByRole("button", { name: "新建分组" }));
    fireEvent.change(screen.getByRole("textbox", { name: "分组名称" }), { target: { value: "Review" } });
    fireEvent.click(screen.getByRole("button", { name: "保存分组" }));

    expect(sidebar.upsertSidebarGroup).toHaveBeenCalledWith(expect.objectContaining({
      name: "Review",
      collapsed: false,
      sessionIds: [],
    }));
    const group = (sidebar.upsertSidebarGroup as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(group.id).toMatch(/^group_/);
    expect(JSON.stringify(group)).not.toMatch(/[\\/]/);
  });

  it("renders an accessible empty-group drop target with a new-task action", () => {
    const sidebar = controller();
    sidebar.state.groups = [{ id: "empty", name: "Empty", collapsed: false, sessionIds: [] }];
    const onNew = vi.fn();
    const onNewInGroup = vi.fn();
    render(<Sidebar t={t} appName="App" sessions={sessions} activeId={null} sidebar={sidebar} onSelect={() => {}} onNew={onNew} onNewInGroup={onNewInGroup} onDelete={() => {}} onArchive={() => {}} onOpenSettings={() => {}} view="groups" />);

    expect(screen.getByRole("button", { name: "在 Empty 中新建任务" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拖放到 Empty" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "在 Empty 中新建任务" }));
    expect(onNewInGroup).toHaveBeenCalledWith("empty");
    expect(onNew).not.toHaveBeenCalled();
  });

  it("loads the same repository logo asset in the icon rail", () => {
    const onLogoClick = vi.fn();
    render(<NavRail logo={{ src: logoUrl, alt: "InnocenceHarness Logo", onClick: onLogoClick }} items={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "InnocenceHarness Logo" }));
    expect(onLogoClick).toHaveBeenCalledOnce();
    const logo = screen.getByRole("button", { name: "InnocenceHarness Logo" }).querySelector("img");
    expect(logo).not.toBeNull();
    expect(decodeURIComponent(logo?.getAttribute("src") ?? "")).toContain("polyline points='38,42 62,64 38,86'");
  });

  it("excludes archived sessions from the active tree, expands recovery, and restores by id", () => {
    const sidebar = controller();
    const onArchive = vi.fn();
    render(<Sidebar t={t} appName="App" sessions={sessions} activeId={null} sidebar={sidebar} onSelect={() => {}} onNew={() => {}} onDelete={() => {}} onArchive={onArchive} onOpenSettings={() => {}} />);

    expect(screen.queryByRole("button", { name: "Archived" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
    expect(screen.getByRole("button", { name: "恢复归档" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复归档" }));
    expect(onArchive).toHaveBeenCalledWith("archived");
  });

  it("renders only a LoaderCircle for running, then static permission or failure markers", () => {
    const sidebar = controller();
    const { rerender } = render(<Sidebar t={t} appName="App" sessions={sessions} activeId={null} sidebar={sidebar} sessionStatuses={new Map([["active", "running"]])} onSelect={() => {}} onNew={() => {}} onDelete={() => {}} onArchive={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByLabelText("running")).toBeTruthy();
    rerender(<Sidebar t={t} appName="App" sessions={sessions} activeId={null} sidebar={sidebar} sessionStatuses={new Map([["active", "waiting-permission"]])} onSelect={() => {}} onNew={() => {}} onDelete={() => {}} onArchive={() => {}} onOpenSettings={() => {}} />);
    expect(screen.queryByLabelText("running")).toBeNull();
    expect(screen.getByLabelText("waiting-permission")).toBeTruthy();
    rerender(<Sidebar t={t} appName="App" sessions={sessions} activeId={null} sidebar={sidebar} sessionStatuses={new Map([["active", "failed"]])} onSelect={() => {}} onNew={() => {}} onDelete={() => {}} onArchive={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByLabelText("failed")).toBeTruthy();
  });
});
