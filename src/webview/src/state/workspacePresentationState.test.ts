import { describe, expect, it } from "vitest";
import {
  defaultWorkspacePresentationState,
  persistWorkspacePresentationState,
  reduceWorkspacePresentationState,
  restoreWorkspacePresentationState,
  workspaceLayoutForWidth,
  type WorkspacePresentationAction,
} from "./workspacePresentationState";

describe("workspace presentation state", () => {
  it("keeps sidebar and capsule disclosure independent", () => {
    const collapsed = reduceWorkspacePresentationState(defaultWorkspacePresentationState, {
      type: "capsule/toggle",
    });
    expect(collapsed.capsuleOpen).toBe(false);
    expect(collapsed.expandedCapsuleSections).toContain("environment");

    const processClosed = reduceWorkspacePresentationState(collapsed, {
      type: "capsule/toggle-section",
      section: "process",
    });
    expect(processClosed.expandedCapsuleSections).not.toContain("process");
    expect(processClosed.capsuleOpen).toBe(false);
  });

  it("uses one content width model for messages, composer, and capsule", () => {
    expect(workspaceLayoutForWidth(1440)).toEqual({
      contentMaxWidth: 960,
      contentGutter: 32,
      capsuleGap: 24,
      capsulePlacement: "docked",
    });
    expect(workspaceLayoutForWidth(900).capsulePlacement).toBe("overlay");
    expect(workspaceLayoutForWidth(520)).toMatchObject({
      contentGutter: 16,
      capsulePlacement: "sheet",
    });
  });

  it("restores project disclosures and ignores malformed UI preference data", () => {
    const collapsed = reduceWorkspacePresentationState(defaultWorkspacePresentationState, {
      type: "sidebar/project-toggle",
      projectId: "D:/alpha",
    });
    const restored = restoreWorkspacePresentationState(persistWorkspacePresentationState(collapsed));
    expect(restored.collapsedProjectIds).toEqual(["D:/alpha"]);
    expect(restoreWorkspacePresentationState("not-json")).toEqual(defaultWorkspacePresentationState);
  });

  it("supports the durable sidebar view without owning session state", () => {
    const action: WorkspacePresentationAction = { type: "sidebar/view", view: "groups" };
    const next = reduceWorkspacePresentationState(defaultWorkspacePresentationState, action);
    expect(next.sidebarView).toBe("groups");
    expect(next.sidebarFilter).toBe("");
  });
});
