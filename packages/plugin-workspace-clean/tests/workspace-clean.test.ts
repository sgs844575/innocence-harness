import { describe, expect, it } from "vitest";
import type { Context } from "@innocenceharness/kernel";
import type { PromptContext, PromptFragment } from "@innocenceharness/harness-system-prompt";
import { WorkspaceCleanPlugin, workspaceCleanFragments } from "../src/index";

function fakeContext() {
  const fragments: PromptFragment[] = [];
  const ctx = {
    systemPrompt: { registerFragment: (fragment: PromptFragment) => fragments.push(fragment) },
  };
  return { ctx: ctx as unknown as Context, fragments };
}

const renderText = (fragment: PromptFragment): string =>
  fragment.render({ activeMode: "default" } as unknown as PromptContext);

describe("workspace-clean plugin", () => {
  it("registers exactly one shared policy fragment; plugin name equals the manifest id", () => {
    const { ctx, fragments } = fakeContext();
    WorkspaceCleanPlugin.apply(ctx);
    expect(WorkspaceCleanPlugin.name).toBe("workspace-clean");
    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({ id: "workspace-clean.policy", order: 2020 });
    // 无 modes 无 when = 共享桶：全模式生效。
    expect(fragments[0]!.modes).toBeUndefined();
    expect(fragments[0]!.when).toBeUndefined();
  });

  it("renders both mandates: post-task scratch cleanup and tool-first execution", () => {
    const text = renderText(workspaceCleanFragments[0]!);
    expect(text).toMatch(/# Workspace hygiene/);
    expect(text).toMatch(/delete every such file/);
    expect(text).toMatch(/# Tools first|## Tools first/);
    expect(text).toMatch(/through tools/);
  });

  it("cleanup is bounded to the task's own footprint (never the user's files)", () => {
    const text = renderText(workspaceCleanFragments[0]!);
    expect(text).toMatch(/[Nn]ever remove/);
    expect(text).toMatch(/before you report a task finished/i);
  });

  it("prompt content stays English (no CJK) per repo rule", () => {
    for (const fragment of workspaceCleanFragments) {
      expect(renderText(fragment)).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });
});
