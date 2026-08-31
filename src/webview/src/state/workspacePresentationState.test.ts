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
    // 满宽窗口：列 1120px 封顶，左右留白等比扩张至 (1440-1120)/2=160。
    expect(workspaceLayoutForWidth(1440)).toEqual({
      contentMaxWidth: 1120,
      contentGutter: 160,
      contentRightGutter: 160,
      capsulePlacement: "floating",
    });
    // 中窗：左右留白等大（900×0.08=72），内容列吃满余量（900-72-72）。
    expect(workspaceLayoutForWidth(900)).toEqual({
      contentMaxWidth: 756,
      contentGutter: 72,
      contentRightGutter: 72,
      capsulePlacement: "floating",
    });
    // 中窄窗：留白仍按 8% 缩（650×0.08=52，左右等大），24px 下限仅在极窄时兜底。
    expect(workspaceLayoutForWidth(650)).toMatchObject({
      contentGutter: 52,
      contentRightGutter: 52,
      capsulePlacement: "floating",
    });
    expect(workspaceLayoutForWidth(520)).toMatchObject({
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
