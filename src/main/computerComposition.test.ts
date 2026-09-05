import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, AgentSession } from "@innocenceharness/harness-electron";
import { createMockProvider } from "@innocenceharness/provider-mock";
import { createExecutionScope } from "@innocenceharness/harness-tools";
import { createSessionComposition } from "./pluginBoot/sessionComposition";
import { stagingBootPaths } from "./staging-paths";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe("staged computer capability", () => {
  it("loads tools and skill through staging and removes them after a settings rebuild", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "computer-composition-"));
    cleanups.push(() => rm(workspace, { recursive: true, force: true }));
    let enabled = true;
    const composition = createSessionComposition({
      resolvePaths: stagingBootPaths, getWorkspaceRoot: () => workspace,
      getUserPluginRoot: () => path.join(workspace, "plugins"),
      isComputerEnabled: () => enabled, enableHmrWatcher: false, log: () => {},
    });
    cleanups.push(() => composition.disposePluginBoot());
    const boot = await composition.ensureBoot();
    const settings = { ...DEFAULT_SETTINGS, workspaceRoot: workspace };
    const requests: string[] = [];
    const build = async (computerEnabled: boolean) => {
      const session = await AgentSession.create({
        scope: boot.createSessionScope(),
        plugins: await composition.composePlugins(workspace, undefined, { ...settings, computerEnabled }),
        provider: createMockProvider({ turns: [{ text: "Ready" }], onChat: (request) => { requests.push(JSON.stringify(request)); } }),
        workspaceRoot: workspace, spine: boot.spine,
        permission: { mode: "full", decider: { ask: async () => "deny" } },
      });
      cleanups.push(() => session.dispose());
      return session;
    };
    const active = await build(true);
    const hasNative = process.platform === "win32";
    expect(active.registry.tools.has("computer_screenshot")).toBe(hasNative);
    await active.run("/computer-control Inspect the window");
    expect(requests.at(-1)?.includes("Take a fresh screenshot")).toBe(hasNative);
    expect((await composition.skillCatalog(workspace, settings)).some((skill) => skill.name === "computer-control")).toBe(hasNative);
    enabled = false;
    if (hasNative) {
      expect(await active.registry.tools.get("computer_screenshot")!.execute({}, {
        workspaceRoot: workspace, signal: new AbortController().signal, log: () => {}, scope: createExecutionScope("test"),
      })).toMatchObject({ content: "Computer control is disabled in Settings.", isError: true });
    }
    await mkdir(path.join(workspace, ".innocence"), { recursive: true });
    await writeFile(path.join(workspace, ".innocence", "plugins.yml"), "plugins:\n  computer: true\n", "utf8");
    const disabled = await build(false);
    expect(disabled.registry.tools.has("computer_screenshot")).toBe(false);
    await disabled.run("Ready");
    expect(requests.at(-1)).not.toContain("computer-control");
    expect((await composition.skillCatalog(workspace, { ...settings, computerEnabled: false })).some((skill) => skill.name === "computer-control")).toBe(false);
  });
});
