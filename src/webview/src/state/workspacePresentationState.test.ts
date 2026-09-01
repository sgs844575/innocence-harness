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
    // 最大化 1440：左 = clamp(round(115), 24, 100) = 100；右 = 337；列 = min(1120, 1440-100-337) = 1003
    expect(workspaceLayoutForWidth(1440, true)).toEqual({
      contentMaxWidth: 1003,
      contentGutter: 100,
      contentRightGutter: 337,
      capsulePlacement: "floating",
    });
    // 最大化 900：左 = 72；右 = 337；列 = min(1120, 900-72-337) = 491
    expect(workspaceLayoutForWidth(900, true)).toEqual({
      contentMaxWidth: 491,
      contentGutter: 72,
      contentRightGutter: 337,
      capsulePlacement: "floating",
    });
    // 最大化 650：左 = 52；右 = 337；列 = min(1120, 650-52-337) = 261
    expect(workspaceLayoutForWidth(650, true)).toMatchObject({
      contentGutter: 52,
      contentRightGutter: 337,
      capsulePlacement: "floating",
    });
    expect(workspaceLayoutForWidth(520, true)).toMatchObject({
      contentGutter: 16,
      contentRightGutter: 16,
      capsulePlacement: "sheet",
    });
    // 最大化 2100：列封顶 1120，右仍只留胶囊位 337
    expect(workspaceLayoutForWidth(2100, true)).toMatchObject({
      contentMaxWidth: 1120,
      contentRightGutter: 337,
    });
  });

  it("centers the chat column with equal gutters when the window is not maximized", () => {
    // 1440：理想留白 = clamp(round(115), 24, 100) = 100；列 = min(1120, 1440-200) = 1120；
    // 留白 = (1440-1120)/2 = 160
    expect(workspaceLayoutForWidth(1440, false)).toEqual({
      contentMaxWidth: 1120,
      contentGutter: 160,
      contentRightGutter: 160,
      capsulePlacement: "floating",
    });
    // 900：理想留白 = 72；列 = min(1120, 900-144) = 756；留白 = (900-756)/2 = 72
    expect(workspaceLayoutForWidth(900, false)).toEqual({
      contentMaxWidth: 756,
      contentGutter: 72,
      contentRightGutter: 72,
      capsulePlacement: "floating",
    });
    // 650：理想留白 = 52；列 = min(1120, 650-104) = 546；留白 = (650-546)/2 = 52
    expect(workspaceLayoutForWidth(650, false)).toMatchObject({
      contentMaxWidth: 546,
      contentGutter: 52,
      contentRightGutter: 52,
      capsulePlacement: "floating",
    });
    // 2100：列封顶 1120，多余宽度平分两侧 (2100-1120)/2 = 490
    expect(workspaceLayoutForWidth(2100, false)).toMatchObject({
      contentMaxWidth: 1120,
      contentRightGutter: 490,
    });
    // 窄窗 sheet 形态与最大化无关
    expect(workspaceLayoutForWidth(520, false)).toMatchObject({
      contentGutter: 16,
      contentRightGutter: 16,
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
