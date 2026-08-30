// S2a：父会话标记 isolatedWorktree 时，子代理会话的系统提示词包含隔离
// 纪律片段；未标记则不包含。createSpawnerChildSession 直测（静态脊柱）。
import { describe, expect, it } from "vitest";
import { PermissionEngine } from "@innocenceharness/harness-permissions";
import type { SpawnerChildMaterials } from "@innocenceharness/harness-agent";
import type { Provider } from "@innocenceharness/harness-providers";
import { createSpawnerChildSession } from "../src/session-spawner";
import { staticSpineSuite } from "../src/session-spine";
import type { AgentSessionOptions } from "../src/session-options";

const allowEngine = () =>
  new PermissionEngine({ mode: "auto", decider: { ask: async () => "deny" as const } });

function capturingProvider(onSystem: (system: string) => void): Provider {
  return {
    id: "capture",
    async *chat(req) {
      onSystem(req.system);
      yield { type: "text", text: "done" };
    },
  } as Provider;
}

function materials(onSystem: (system: string) => void): SpawnerChildMaterials {
  return {
    tools: [],
    processors: [],
    middlewares: [],
    provider: capturingProvider(onSystem),
    permission: allowEngine(),
    systemPrompt: "CHILD-PERSONA",
    maxTurns: 5,
    logger: () => {},
  };
}

function parentOptions(overrides: Partial<AgentSessionOptions> = {}): AgentSessionOptions {
  return {
    plugins: [],
    workspaceRoot: "D:/worktree",
    permission: { mode: "auto", decider: { ask: async () => "deny" as const } },
    spine: staticSpineSuite(),
    ...overrides,
  };
}

describe("spawner child worktree fragment (S2a)", () => {
  it("registers the isolation fragment for children of worktree sessions", async () => {
    let childSystem = "";
    const child = await createSpawnerChildSession(
      parentOptions({ isolatedWorktree: true }),
      materials((system) => (childSystem = system)),
    );
    await child.run("任务", undefined, {});
    expect(childSystem).toContain("CHILD-PERSONA");
    expect(childSystem).toContain("Isolated worktree discipline");
    await child.dispose();
  });

  it("omits the fragment for children of ordinary sessions", async () => {
    let childSystem = "";
    const child = await createSpawnerChildSession(
      parentOptions(),
      materials((system) => (childSystem = system)),
    );
    await child.run("任务", undefined, {});
    expect(childSystem).toContain("CHILD-PERSONA");
    expect(childSystem).not.toContain("Isolated worktree discipline");
    await child.dispose();
  });
});
