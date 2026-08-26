import { describe, expect, it } from "vitest";
import type { SidebarState } from "../../../../shared/sidebarIpc";
import { resolveSidebarDrag } from "./dnd";

const state: SidebarState = {
  version: 1,
  order: ["a", "b", "c", "u"],
  archived: { a: false, b: false, c: false, u: false },
  groups: [
    { id: "g-one", name: "One", collapsed: false, sessionIds: ["a", "b", "c"] },
    { id: "g-two", name: "Two", collapsed: false, sessionIds: [] },
  ],
  ungrouped: ["u"],
  projectOrder: [],
  manualProjectOrders: {},
  manualUngrouped: false,
  projects: [],
};

describe("resolveSidebarDrag", () => {
  it("moves downward in a group before the hovered session", () => {
    expect(resolveSidebarDrag(state, "groups", "session:a", "session:c")).toEqual({
      type: "move-session",
      id: "a",
      target: { kind: "group", groupId: "g-one" },
      beforeId: "c",
    });
  });

  it("moves upward in a group before the hovered session", () => {
    expect(resolveSidebarDrag(state, "groups", "session:c", "session:a")).toEqual({
      type: "move-session",
      id: "c",
      target: { kind: "group", groupId: "g-one" },
      beforeId: "a",
    });
  });

  it("moves a session onto another group session with its container and before id", () => {
    const destination: SidebarState = { ...state, groups: [state.groups[0]!, { ...state.groups[1]!, sessionIds: ["u"] }], ungrouped: [] };
    expect(resolveSidebarDrag(destination, "groups", "session:a", "session:u")).toEqual({
      type: "move-session",
      id: "a",
      target: { kind: "group", groupId: "g-two" },
      beforeId: "u",
    });
  });

  it("moves a session onto the ungrouped target", () => {
    expect(resolveSidebarDrag(state, "groups", "session:a", "container:ungrouped")).toEqual({
      type: "move-session",
      id: "a",
      target: { kind: "ungrouped" },
    });
  });

  it("reorders group headers through their top-level sortable ids", () => {
    expect(resolveSidebarDrag(state, "groups", "header:g-two", "header:g-one")).toEqual({
      type: "reorder-containers",
      kind: "groups",
      orderedIds: ["g-two", "g-one"],
    });
  });

  it("does not emit a drag command while filtering", () => {
    expect(resolveSidebarDrag(state, "groups", "session:a", "session:c", true)).toBeNull();
  });
});
