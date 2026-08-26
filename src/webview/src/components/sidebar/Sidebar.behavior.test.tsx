// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "../../../../shared/ipc";
import type { SidebarStateController } from "../../state/useSidebarState";
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

describe("Sidebar archive and session statuses", () => {
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
