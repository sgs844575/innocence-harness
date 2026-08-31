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

  it("uses one fluid content width model for messages, composer, and capsule", () => {
    // 1440 视窗：左 = clamp(round(115), 24, 100) = 100；右 = clamp(337+115, 337, 500) = 452；
    // 列 = min(1120, 1440-100-452) = 888
    expect(workspaceLayoutForWidth(1440)).toEqual({
      contentMaxWidth: 888,
      contentGutter: 100,
      contentRightGutter: 452,
      capsulePlacement: "floating",
    });
    // 900 视窗：左 = clamp(round(72), 24, 100) = 72；右 = clamp(337+72, 337, 500) = 409；
    // 列 = min(1120, 900-72-409) = 419
    expect(workspaceLayoutForWidth(900)).toEqual({
      contentMaxWidth: 419,
      contentGutter: 72,
      contentRightGutter: 409,
      capsulePlacement: "floating",
    });
    // 650 视窗：左 = clamp(round(52), 24, 100) = 52；右 = clamp(337+52, 337, 500) = 389；
    // 列 = min(1120, 650-52-389) = 209
    expect(workspaceLayoutForWidth(650)).toMatchObject({
      contentGutter: 52,
      contentRightGutter: 389,
      capsulePlacement: "floating",
    });
    expect(workspaceLayoutForWidth(520)).toMatchObject({
      contentGutter: 16,
      contentRightGutter: 16,
      capsulePlacement: "sheet",
    });
    // 2100 视窗：右触顶 500
    expect(workspaceLayoutForWidth(2100)).toMatchObject({
      contentRightGutter: 500,
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

  it("selects a relative file path for the code panel view model", () => {
    const next = reduceWorkspacePresentationState(defaultWorkspacePresentationState, {
      type: "file/select",
      path: "src/renderer/App.tsx",
    });
    expect(next.selectedFilePath).toBe("src/renderer/App.tsx");
  });

  it("supports the durable sidebar view without owning session state", () => {
    const action: WorkspacePresentationAction = { type: "sidebar/view", view: "groups" };
    const next = reduceWorkspacePresentationState(defaultWorkspacePresentationState, action);
    expect(next.sidebarView).toBe("groups");
    expect(next.sidebarFilter).toBe("");
  });
});
