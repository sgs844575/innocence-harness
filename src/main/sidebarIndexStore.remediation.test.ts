import * as fs from "node:fs";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SidebarPersistenceError,
  createSidebarIndexStore,
  sidebarIndexFile,
  sidebarProjectId,
} from "./sidebarIndexStore";

const sessions = [
  { id: "s-a", title: "A", createdAt: 1, updatedAt: 1, messageCount: 0, workspaceRoot: "D:/work/alpha" },
  { id: "s-b", title: "B", createdAt: 2, updatedAt: 2, messageCount: 0, workspaceRoot: "D:/work/alpha" },
  { id: "s-c", title: "C", createdAt: 3, updatedAt: 3, messageCount: 0, workspaceRoot: "D:/work/beta" },
  { id: "s-u", title: "U", createdAt: 4, updatedAt: 4, messageCount: 0, workspaceRoot: "" },
] as const;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ic-sidebar-remediation-"));
});

function actualOps(overrides: Partial<typeof fs> = {}): Pick<typeof fs, "mkdirSync" | "readFileSync" | "writeFileSync" | "renameSync" | "unlinkSync"> {
  return {
    mkdirSync: fs.mkdirSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    ...overrides,
  };
}

describe("sidebar index remediation", () => {
  it("uses opaque project ids instead of workspace paths in the renderer state", () => {
    const state = createSidebarIndexStore(dir, sessions).getSidebarState();
    expect(state.projects.map((project) => project.id)).toEqual([
      sidebarProjectId("D:/work/alpha"),
      sidebarProjectId("D:/work/beta"),
    ]);
    expect(JSON.stringify(state)).not.toContain("D:/work/alpha");
  });

  it("requires explicit project, group, or ungrouped container identity", () => {
    const store = createSidebarIndexStore(dir, sessions);
    const alpha = sidebarProjectId("D:/work/alpha");
    store.reorderSessions({ kind: "project", projectId: alpha }, ["s-b", "s-a"]);
    store.upsertSidebarGroup({ id: "g-one", name: "One" });
    store.moveSession("s-u", { kind: "group", groupId: "g-one" }, undefined);

    const state = store.getSidebarState();
    expect(state.projects.find((project) => project.id === alpha)?.sessionIds).toEqual(["s-b", "s-a"]);
    expect(state.groups[0]?.sessionIds).toEqual(["s-u"]);
  });

  it("moves downward in a group before the target row without index drift", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.upsertSidebarGroup({ id: "g-one", name: "One", sessionIds: ["s-a", "s-b", "s-c"] });
    store.moveSession("s-a", { kind: "group", groupId: "g-one" }, "s-c");

    expect(store.getSidebarState().groups[0]?.sessionIds).toEqual(["s-b", "s-a", "s-c"]);
  });

  it("moves across group session rows at the requested before id", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.upsertSidebarGroup({ id: "g-one", name: "One", sessionIds: ["s-a"] });
    store.upsertSidebarGroup({ id: "g-two", name: "Two", sessionIds: ["s-b"] });
    store.moveSession("s-a", { kind: "group", groupId: "g-two" }, "s-b");

    expect(store.getSidebarState().groups.find((group) => group.id === "g-two")?.sessionIds).toEqual(["s-a", "s-b"]);
  });

  it("persists project and custom-group header order", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.upsertSidebarGroup({ id: "g-one", name: "One" });
    store.upsertSidebarGroup({ id: "g-two", name: "Two" });
    store.reorderContainers("groups", ["g-two", "g-one"]);
    store.reorderContainers("projects", [sidebarProjectId("D:/work/beta"), sidebarProjectId("D:/work/alpha")]);

    const restarted = createSidebarIndexStore(dir, sessions).getSidebarState();
    expect(restarted.groups.map((group) => group.id)).toEqual(["g-two", "g-one"]);
    expect(restarted.projects.map((project) => project.id)).toEqual([
      sidebarProjectId("D:/work/beta"),
      sidebarProjectId("D:/work/alpha"),
    ]);
  });

  it("does not publish a staged archive mutation after a write failure", () => {
    const writeFileSync = vi.fn(() => { throw new Error("disk full"); });
    const store = createSidebarIndexStore(dir, sessions, { ops: actualOps({ writeFileSync }) });
    const before = store.getSidebarState();

    expect(() => store.archiveSession("s-a", true)).toThrow(SidebarPersistenceError);
    expect(store.getSidebarState()).toEqual(before);
    expect(writeFileSync).toHaveBeenCalledOnce();
  });

  it("does not publish a staged move after a rename failure and retains the previous file", () => {
    const file = sidebarIndexFile(dir);
    const store = createSidebarIndexStore(dir, sessions);
    store.upsertSidebarGroup({ id: "g-one", name: "One" });
    const before = store.getSidebarState();
    const previousFile = readFileSync(file, "utf8");
    const renameSync = vi.fn(() => { throw new Error("locked"); });
    const failing = createSidebarIndexStore(dir, sessions, { ops: actualOps({ renameSync }) });

    expect(() => failing.moveSession("s-a", { kind: "group", groupId: "g-one" })).toThrow(SidebarPersistenceError);
    expect(failing.getSidebarState()).toEqual(before);
    expect(renameSync).toHaveBeenCalledOnce();
    expect(readFileSync(file, "utf8")).toBe(previousFile);
  });

  it("keeps manual order but inserts newly introduced sessions in authoritative session order", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.reorderSessions({ kind: "project", projectId: sidebarProjectId("D:/work/alpha") }, ["s-b", "s-a"]);
    store.replaceSessions([
      { ...sessions[0], id: "s-new" },
      ...sessions,
    ]);

    expect(store.getSidebarState().projects.find((project) => project.id === sidebarProjectId("D:/work/alpha"))?.sessionIds).toEqual(["s-new", "s-b", "s-a"]);
  });

  it("uses authoritative session order until a user explicitly reorders", () => {
    const store = createSidebarIndexStore(dir, sessions);
    store.replaceSessions([sessions[2], sessions[0], sessions[1], sessions[3]]);
    expect(store.getSidebarState().order).toEqual(["s-c", "s-a", "s-b", "s-u"]);
  });
});
