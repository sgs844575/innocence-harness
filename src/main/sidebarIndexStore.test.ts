import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSidebarIndexStore,
  loadSidebarIndex,
  migrateLegacySessions,
  persistSidebarIndex,
  sidebarIndexFile,
  sidebarProjectId,
  type SidebarIndexDocument,
} from "./sidebarIndexStore";

const sessions = [
  { id: "s-alpha", title: "Alpha", createdAt: 1, updatedAt: 10, messageCount: 1, workspaceRoot: "D:/work/alpha" },
  { id: "s-none", title: "None", createdAt: 2, updatedAt: 20, messageCount: 0, workspaceRoot: "" },
  { id: "s-beta", title: "Beta", createdAt: 3, updatedAt: 30, messageCount: 2, workspaceRoot: "D:/work/beta" },
] as const;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-sidebar-"));
});

describe("sidebar index migration", () => {
  it("migrates legacy sessions into stable order, implicit projects, and ungrouped", () => {
    const document = migrateLegacySessions(sessions);
    expect(document.version).toBe(1);
    expect(document.order).toEqual(["s-alpha", "s-none", "s-beta"]);
    expect(document.archived).toEqual({ "s-alpha": false, "s-none": false, "s-beta": false });
    expect(document.groups).toEqual([]);
    expect(document.ungrouped).toEqual(["s-alpha", "s-none", "s-beta"]);
  });

  it("keeps custom group membership independent from workspace/project affiliation", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.upsertSidebarGroup({ id: "g-review", name: "Review", collapsed: false });
    store.moveSession("s-alpha", { kind: "group", groupId: "g-review" });

    const state = store.getSidebarState();
    expect(state.groups[0]?.sessionIds).toEqual(["s-alpha"]);
    expect(state.ungrouped).toEqual(["s-none", "s-beta"]);
    expect(state.order).toEqual(["s-alpha", "s-none", "s-beta"]);
  });

  it("defaults archive state to false and persists archive changes across restart", () => {
    const store = createSidebarIndexStore(dir, sessions);
    expect(store.getSidebarState().archived).toEqual({ "s-alpha": false, "s-none": false, "s-beta": false });
    store.archiveSession("s-beta", true);

    const restarted = createSidebarIndexStore(dir, sessions);
    expect(restarted.getSidebarState().archived["s-beta"]).toBe(true);
    expect(restarted.getSidebarState().archived["s-alpha"]).toBe(false);
  });

  it("uses the requested custom-group order rather than the global session order", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.upsertSidebarGroup({ id: "g-review", name: "Review", sessionIds: ["s-beta", "s-alpha"] });

    expect(store.getSidebarState().groups[0]?.sessionIds).toEqual(["s-beta", "s-alpha"]);
  });

  it("reorders project sessions from session ids without requiring a project path", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.reorderSessions({ kind: "project", projectId: sidebarProjectId("D:/work/alpha") }, ["s-alpha"]);
    expect(store.getSidebarState().projects.find((project) => project.id === sidebarProjectId("D:/work/alpha"))?.sessionIds).toEqual(["s-alpha"]);
  });

  it("moves sessions out of prior memberships when updating an existing group", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.upsertSidebarGroup({ id: "g-one", name: "One", sessionIds: ["s-alpha"] });
    store.upsertSidebarGroup({ id: "g-two", name: "Two", sessionIds: ["s-alpha"] });

    const state = store.getSidebarState();
    expect(state.groups.find((group) => group.id === "g-one")?.sessionIds).toEqual([]);
    expect(state.groups.find((group) => group.id === "g-two")?.sessionIds).toEqual(["s-alpha"]);
    expect(state.ungrouped).not.toContain("s-alpha");
  });

  it("preserves custom ordering, cross-group moves, and collapsed state after restart", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.upsertSidebarGroup({ id: "g-review", name: "Review" });
    store.upsertSidebarGroup({ id: "g-empty", name: "Empty", collapsed: true });
    store.moveSession("s-alpha", { kind: "group", groupId: "g-review" });
    store.moveSession("s-beta", { kind: "group", groupId: "g-review" }, "s-alpha");
    store.setSidebarGroupCollapsed("g-review", true);

    const restarted = createSidebarIndexStore(dir, sessions);
    const state = restarted.getSidebarState();
    expect(state.groups.find((group) => group.id === "g-review")?.sessionIds).toEqual(["s-beta", "s-alpha"]);
    expect(state.groups.find((group) => group.id === "g-review")?.collapsed).toBe(true);
    expect(state.groups.find((group) => group.id === "g-empty")?.sessionIds).toEqual([]);
  });

  it("safely recovers a corrupt sidebar file without touching transcripts or crashing", () => {
    const file = sidebarIndexFile(dir);
    writeFileSync(file, "{not valid json", "utf8");
    const loaded = loadSidebarIndex(file, sessions);
    expect(loaded.order).toEqual(["s-alpha", "s-none", "s-beta"]);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir).some((name) => name.startsWith("sidebar.json.corrupt-"))).toBe(true);
  });

  it("leaves the previous sidebar file intact when atomic replacement fails", () => {
    const file = sidebarIndexFile(dir);
    const previous: SidebarIndexDocument = {
      version: 1,
      order: ["old"],
      archived: { old: false },
      groups: [],
      ungrouped: ["old"],
      projectOrder: [],
      manualProjectOrders: {},
      manualUngrouped: false,
      projects: [],
    };
    writeFileSync(file, JSON.stringify(previous), "utf8");

    expect(() => persistSidebarIndex(file, { ...previous, order: ["new"], ungrouped: ["new"] }, {
      renameSync: () => { throw new Error("simulated replacement failure"); },
    })).not.toThrow();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(previous);
  });
});
