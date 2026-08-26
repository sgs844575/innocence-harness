// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../../../shared/ipc";
import type { SidebarStateController } from "../../state/useSidebarState";
import { Sidebar } from "../Sidebar";
import { defaultWorkspacePresentationState, reduceWorkspacePresentationState } from "../../state/workspacePresentationState";

const sessions: Session[] = [
  { id: "alpha-session", title: "Alpha session", createdAt: 1, updatedAt: 1, messageCount: 1, workspaceRoot: "D:/alpha" },
  { id: "group-session", title: "Group session", createdAt: 1, updatedAt: 1, messageCount: 1, workspaceRoot: "" },
];

function controller(): SidebarStateController {
  return {
    state: {
      version: 1,
      order: ["alpha-session", "group-session"],
      archived: {},
      groups: [{ id: "review", name: "Review", collapsed: false, sessionIds: ["group-session"] }],
      ungrouped: [],
      projectOrder: ["D:/alpha"],
      manualProjectOrders: {},
      manualUngrouped: false,
      projects: [{ id: "D:/alpha", name: "alpha", sessionIds: ["alpha-session"] }],
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

describe("Sidebar presentation disclosure", () => {
  it("routes a project disclosure through presentation state and keeps it through a view switch", () => {
    const onToggleProject = vi.fn();
    const { rerender } = render(
      <Sidebar
        t={t}
        appName="App"
        sessions={sessions}
        activeId={null}
        sidebar={controller()}
        view="projects"
        collapsedProjectIds={[]}
        onViewChange={() => {}}
        onToggleProject={onToggleProject}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        onArchive={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "折叠项目 alpha" }));
    expect(onToggleProject).toHaveBeenCalledWith("D:/alpha");

    rerender(
      <Sidebar
        t={t}
        appName="App"
        sessions={sessions}
        activeId={null}
        sidebar={controller()}
        view="projects"
        collapsedProjectIds={["D:/alpha"]}
        onViewChange={() => {}}
        onToggleProject={onToggleProject}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        onArchive={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Alpha session" })).toBeNull();
  });

  it("uses the durable group collapse command while rendering the group view", () => {
    const sidebar = controller();
    render(
      <Sidebar
        t={t}
        appName="App"
        sessions={sessions}
        activeId={null}
        sidebar={sidebar}
        view="groups"
        collapsedProjectIds={[]}
        onViewChange={() => {}}
        onToggleProject={() => {}}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        onArchive={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "折叠分组 Review" }));
    expect(sidebar.setSidebarGroupCollapsed).toHaveBeenCalledWith("review", true);
  });

  it("keeps project disclosure state when the presentation view changes", () => {
    const collapsed = reduceWorkspacePresentationState(defaultWorkspacePresentationState, {
      type: "sidebar/project-toggle",
      projectId: "D:/alpha",
    });
    const switched = reduceWorkspacePresentationState(collapsed, { type: "sidebar/view", view: "groups" });
    expect(switched.collapsedProjectIds).toEqual(["D:/alpha"]);
  });
});
