import { describe, expect, it } from "vitest";
import type { Session } from "../../../../shared/ipc";
import type { SidebarState } from "../../../../shared/sidebarIpc";

import { buildSidebarTree } from "./viewModel";

const sessions: Session[] = [
  { id: "s1", title: "One", createdAt: 1, updatedAt: 1, messageCount: 1, workspaceRoot: "D:/alpha" },
  { id: "s2", title: "Two", createdAt: 2, updatedAt: 2, messageCount: 1, workspaceRoot: "D:/alpha" },
  { id: "s3", title: "Three", createdAt: 3, updatedAt: 3, messageCount: 1, workspaceRoot: "D:/beta" },
  { id: "s4", title: "Four", createdAt: 4, updatedAt: 4, messageCount: 1, workspaceRoot: "" },
];

const state: SidebarState = {
  version: 1,
  order: ["s2", "s1", "s3", "s4"],
  archived: { s1: false, s2: false, s3: false, s4: false },
  groups: [{ id: "g1", name: "Review", collapsed: false, sessionIds: ["s1"] }, { id: "empty", name: "Empty", collapsed: true, sessionIds: [] }],
  ungrouped: ["s2", "s3", "s4"],
  projectOrder: [],
  manualProjectOrders: {},
  manualUngrouped: false,
  projects: [
    { id: "D:/alpha", name: "alpha", sessionIds: ["s2", "s1"] },
    { id: "D:/beta", name: "beta", sessionIds: ["s3"] },
  ],
};

describe("buildSidebarTree", () => {
  it("builds project-first session trees without changing custom group membership", () => {
    const tree = buildSidebarTree(sessions, state, "projects", "Unassigned");
    expect(tree.map((node) => [node.id, node.sessionIds])).toEqual([
      ["D:/alpha", ["s2", "s1"]],
      ["D:/beta", ["s3"]],
      ["__project-unassigned__", ["s4"]],
    ]);
    expect(tree.find((node) => node.id === "D:/alpha")?.sessionIds).not.toContain("g1");
  });

  it("excludes archived sessions from active project and group trees", () => {
    const archivedState = { ...state, archived: { ...state.archived, s3: true } };
    expect(buildSidebarTree(sessions, archivedState, "projects", "Unassigned").flatMap((node) => node.sessionIds)).not.toContain("s3");
    expect(buildSidebarTree(sessions, archivedState, "groups", "Unassigned").flatMap((node) => node.sessionIds)).not.toContain("s3");
  });

  it("preserves the store-resolved project order independently from global session order", () => {
    const projectState = { ...state, order: ["s1", "s2", "s3", "s4"] };
    expect(buildSidebarTree(sessions, projectState, "projects", "Unassigned")[0]?.sessionIds).toEqual(["s2", "s1"]);
  });

  it("preserves persisted custom-group order independently from project order", () => {
    const customState = { ...state, groups: [{ id: "g1", name: "Review", collapsed: false, sessionIds: ["s1", "s2"] }] };
    expect(buildSidebarTree(sessions, customState, "groups", "Unassigned")[0]?.sessionIds).toEqual(["s1", "s2"]);
  });

  it("preserves the store-resolved manual ungrouped order independently from global session order", () => {
    const ungroupedState = { ...state, ungrouped: ["s4", "s3", "s2"], manualUngrouped: true };
    expect(buildSidebarTree(sessions, ungroupedState, "groups", "Unassigned").at(-1)?.sessionIds).toEqual(["s4", "s3", "s2"]);
  });

  it("builds custom groups including empty drop targets and keeps ungrouped sessions separate", () => {
    const tree = buildSidebarTree(sessions, state, "groups", "Unassigned");
    expect(tree.map((node) => [node.id, node.sessionIds, node.collapsed])).toEqual([
      ["g1", ["s1"], false],
      ["empty", [], true],
      ["__sidebar-ungrouped__", ["s2", "s3", "s4"], false],
    ]);
  });
});
