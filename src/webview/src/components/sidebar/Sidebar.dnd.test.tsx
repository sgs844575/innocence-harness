// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DndContextProps, DragEndEvent } from "@dnd-kit/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../../../shared/ipc";
import type { SidebarContainer } from "../../../../shared/sidebarIpc";
import {
  createSidebarIndexStore,
  sidebarProjectId,
  type SidebarIndexStore,
} from "../../../../main/sidebarIndexStore";
import type { SidebarStateController } from "../../state/useSidebarState";
import { Sidebar } from "../Sidebar";
import { buildSidebarTree } from "./viewModel";

const dndHarness = vi.hoisted(() => ({
  onDragEnd: undefined as DndContextProps["onDragEnd"] | undefined,
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const react = await import("react");
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      dndHarness.onDragEnd = props.onDragEnd;
      return react.createElement(actual.DndContext, props);
    },
  };
});

const directories: string[] = [];
afterEach(() => {
  cleanup();
  dndHarness.onDragEnd = undefined;
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function createStore(sessions: readonly Session[]): { dir: string; store: SidebarIndexStore } {
  const dir = mkdtempSync(path.join(tmpdir(), "ic-sidebar-component-dnd-"));
  directories.push(dir);
  return { dir, store: createSidebarIndexStore(dir, sessions) };
}

function controllerFor(store: SidebarIndexStore): SidebarStateController {
  return {
    state: store.getSidebarState(),
    archiveSession: vi.fn(async (id: string, archived: boolean) => store.archiveSession(id, archived)),
    reorderSessions: vi.fn(async (container: SidebarContainer, ids: string[]) => store.reorderSessions(container, ids)),
    moveSession: vi.fn(async (id: string, target: SidebarContainer, beforeId?: string) => store.moveSession(id, target, beforeId)),
    reorderContainers: vi.fn(async (kind: "projects" | "groups", ids: string[]) => store.reorderContainers(kind, ids)),
    upsertSidebarGroup: vi.fn(async (group) => store.upsertSidebarGroup(group)),
    deleteSidebarGroup: vi.fn(async (id: string) => store.deleteSidebarGroup(id)),
    setSidebarGroupCollapsed: vi.fn(async (id: string, collapsed: boolean) => store.setSidebarGroupCollapsed(id, collapsed)),
  };
}

function drag(activeId: string, overId: string): void {
  const event = {
    active: { id: activeId },
    over: { id: overId },
  } as DragEndEvent;
  act(() => dndHarness.onDragEnd?.(event));
}

const t = (key: string) => key;
const callbacks = {
  onSelect: () => {},
  onNew: () => {},
  onDelete: () => {},
  onArchive: () => {},
  onOpenSettings: () => {},
};

function renderSidebar(sessions: Session[], sidebar: SidebarStateController): void {
  render(<Sidebar t={t} appName="App" sessions={sessions} activeId={null} sidebar={sidebar} {...callbacks} />);
}

describe("Sidebar component drag commands", () => {
  it("drives project-view same-container drag through an explicit project command and preserves the resolved order after reload", () => {
    const sessions: Session[] = [
      { id: "p-a", title: "Project A", createdAt: 1, updatedAt: 1, messageCount: 0, workspaceRoot: "D:/work/project" },
      { id: "p-b", title: "Project B", createdAt: 2, updatedAt: 2, messageCount: 0, workspaceRoot: "D:/work/project" },
    ];
    const { dir, store } = createStore(sessions);
    const sidebar = controllerFor(store);
    renderSidebar(sessions, sidebar);

    drag("session:p-b", "session:p-a");

    const projectId = sidebarProjectId("D:/work/project");
    expect(sidebar.moveSession).toHaveBeenCalledWith("p-b", { kind: "project", projectId }, "p-a");
    const reloaded = createSidebarIndexStore(dir, sessions).getSidebarState();
    expect(reloaded.projects[0]?.sessionIds).toEqual(["p-b", "p-a"]);
    expect(buildSidebarTree(sessions, reloaded, "projects", "Unassigned")[0]?.sessionIds).toEqual(["p-b", "p-a"]);
  });

  it("drives group cross-container and ungrouped drops with explicit targets and preserves their resolved order after reload", () => {
    const sessions: Session[] = [
      { id: "g-a", title: "Group A", createdAt: 1, updatedAt: 1, messageCount: 0, workspaceRoot: "" },
      { id: "g-b", title: "Group B", createdAt: 2, updatedAt: 2, messageCount: 0, workspaceRoot: "" },
      { id: "u-a", title: "Ungrouped A", createdAt: 3, updatedAt: 3, messageCount: 0, workspaceRoot: "" },
      { id: "u-b", title: "Ungrouped B", createdAt: 4, updatedAt: 4, messageCount: 0, workspaceRoot: "" },
    ];
    const { dir, store } = createStore(sessions);
    store.upsertSidebarGroup({ id: "g-one", name: "One", sessionIds: ["g-a"] });
    store.upsertSidebarGroup({ id: "g-two", name: "Two", sessionIds: ["g-b"] });
    const sidebar = controllerFor(store);
    renderSidebar(sessions, sidebar);
    fireEvent.click(screen.getByRole("button", { name: "sidebar.groups" }));

    drag("session:g-a", "session:g-b");

    expect(sidebar.moveSession).toHaveBeenNthCalledWith(1, "g-a", { kind: "group", groupId: "g-two" }, "g-b");
    const afterCrossContainer = createSidebarIndexStore(dir, sessions).getSidebarState();
    expect(buildSidebarTree(sessions, afterCrossContainer, "groups", "Unassigned").find((node) => node.id === "g-two")?.sessionIds).toEqual(["g-a", "g-b"]);

    drag("session:g-a", "container:ungrouped");

    expect(sidebar.moveSession).toHaveBeenNthCalledWith(2, "g-a", { kind: "ungrouped" }, undefined);
    const reloaded = createSidebarIndexStore(dir, sessions).getSidebarState();
    expect(reloaded.ungrouped).toEqual(["u-a", "u-b", "g-a"]);
    expect(buildSidebarTree(sessions, reloaded, "groups", "Unassigned").at(-1)?.sessionIds).toEqual(["u-a", "u-b", "g-a"]);
  });

  it("does not emit drag commands while the filter is active", () => {
    const sessions: Session[] = [
      { id: "a", title: "Alpha", createdAt: 1, updatedAt: 1, messageCount: 0, workspaceRoot: "D:/work/project" },
      { id: "b", title: "Beta", createdAt: 2, updatedAt: 2, messageCount: 0, workspaceRoot: "D:/work/project" },
    ];
    const { store } = createStore(sessions);
    const sidebar = controllerFor(store);
    renderSidebar(sessions, sidebar);
    fireEvent.change(screen.getByPlaceholderText("sidebar.filter"), { target: { value: "Alpha" } });

    drag("session:a", "session:b");

    expect(sidebar.moveSession).not.toHaveBeenCalled();
    expect(sidebar.reorderContainers).not.toHaveBeenCalled();
  });
});
