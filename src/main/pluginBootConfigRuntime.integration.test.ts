// Real boot and route-loader coverage for config-invalid and optional entry
// isolation. Uses the staged distribution tree, not direct resolver calls.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSession } from "@innocencecode/harness-electron";
import { createMockProvider } from "@innocencecode/provider-mock";
import { createSessionComposition } from "./pluginBoot";
import { stagingBootPaths } from "./staging-paths";

const paths = stagingBootPaths();
const maybeDescribe = existsSync(paths.kernelPath) ? describe : describe.skip;
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function composition(log: (message: string) => void = () => {}) {
  return createSessionComposition({
    resolvePaths: () => paths,
    getWorkspaceRoot: () => undefined,
    log: (_level, message) => log(message),
  });
}

maybeDescribe("plugin boot config and route loader", () => {
  it("project invalid skills config becomes config-invalid and leaves the session usable", async () => {
    const workspace = tempRoot("ic-invalid-project-");
    mkdirSync(path.join(workspace, ".innocence"), { recursive: true });
    writeFileSync(
      path.join(workspace, ".innocence", "plugins.yml"),
      "plugins:\n  skills:\n    config:\n      dirs: invalid\n",
      "utf8",
    );
    const host = composition();
    const boot = await host.ensureBoot();
    const inventory = await host.pluginInventory({ workspaceRoot: workspace });
    expect(inventory.find((entry) => entry.id === "skills")).toMatchObject({
      state: "config-invalid",
      via: "project",
    });
    const session = await AgentSession.create({
      scope: boot.createSessionScope(),
      spine: boot.spine,
      plugins: await host.composePlugins(workspace),
      provider: createMockProvider({ turns: [{ text: "usable" }] }),
      workspaceRoot: workspace,
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
    });
    expect(session.registry.tools.has("Read")).toBe(true);
    expect(session.loaderEntries.map((entry) => entry.options.id)).not.toContain("skills");
    await session.dispose();
    await host.disposePluginBoot();
  });

  it("user invalid skills config disables its dependent and still builds a session", async () => {
    const home = tempRoot("ic-invalid-user-home-");
    const workspace = tempRoot("ic-invalid-user-workspace-");
    const resources = tempRoot("ic-invalid-user-resources-");
    const pluginRoot = path.join(resources, "plugins");
    cpSync(paths.builtinRoot, pluginRoot, { recursive: true });
    cpSync(path.join(path.dirname(paths.builtinRoot), "node_modules"), path.join(resources, "node_modules"), {
      recursive: true,
    });
    const manifestFile = path.join(pluginRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { plugins: Array<Record<string, unknown>> };
    manifest.plugins.push({ id: "dependent", dependencies: ["skills"] });
    writeFileSync(manifestFile, JSON.stringify(manifest), "utf8");
    mkdirSync(path.join(home, ".innocence"), { recursive: true });
    writeFileSync(
      path.join(home, ".innocence", "cordis.yml"),
      "plugins:\n  skills:\n    config:\n      dirs: invalid\n",
      "utf8",
    );
    const previousHome = process.env.USERPROFILE ?? process.env.HOME;
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      const host = createSessionComposition({
        resolvePaths: () => ({ kernelPath: paths.kernelPath, builtinRoot: pluginRoot }),
        getWorkspaceRoot: () => undefined,
        log: () => {},
      });
      const boot = await host.ensureBoot();
      const inventory = await host.pluginInventory({ workspaceRoot: workspace });
      expect(inventory.find((entry) => entry.id === "skills")).toMatchObject({
        state: "config-invalid",
        via: "user",
      });
      const resolved = await boot.resolveBuiltinSet({ workspaceRoot: workspace });
      expect(resolved.skipped).toContainEqual({ id: "skills", reason: "config-invalid", via: "user" });
      expect(resolved.skipped).toContainEqual({ id: "dependent", reason: "dependency-disabled", via: "user" });
      const session = await AgentSession.create({
        scope: boot.createSessionScope(),
        spine: boot.spine,
        plugins: await host.composePlugins(workspace),
        provider: createMockProvider({ turns: [{ text: "usable" }] }),
        workspaceRoot: workspace,
        permission: { mode: "auto", decider: { ask: async () => "deny" } },
      });
      expect(session.registry.tools.has("Read")).toBe(true);
      expect(session.loaderEntries.map((entry) => entry.options.id)).not.toContain("skills");
      await session.dispose();
      await host.disposePluginBoot();
    } finally {
      if (previousHome === undefined) {
        delete process.env.USERPROFILE;
        delete process.env.HOME;
      } else {
        process.env.USERPROFILE = previousHome;
        process.env.HOME = previousHome;
      }
    }
  });

  it("mounts route loader entries and isolates apply and import failures", async () => {
    const resources = tempRoot("ic-route-loader-resources-");
    const pluginRoot = path.join(resources, "plugins");
    cpSync(paths.builtinRoot, pluginRoot, { recursive: true });
    cpSync(path.join(path.dirname(paths.builtinRoot), "node_modules"), path.join(resources, "node_modules"), {
      recursive: true,
    });
    const manifestFile = path.join(pluginRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { plugins: Array<Record<string, unknown>> };
    manifest.plugins.push({ id: "failing", dependencies: [] }, { id: "missing", dependencies: [] });
    writeFileSync(manifestFile, JSON.stringify(manifest), "utf8");
    const failingDir = path.join(pluginRoot, "failing", "dist");
    mkdirSync(failingDir, { recursive: true });
    writeFileSync(
      path.join(failingDir, "index.js"),
      "export default { name: 'failing', apply() { throw new Error('fixture failure'); } };\n",
      "utf8",
    );
    const logs: string[] = [];
    const host = createSessionComposition({
      resolvePaths: () => ({ kernelPath: paths.kernelPath, builtinRoot: pluginRoot }),
      getWorkspaceRoot: () => undefined,
      log: (_level, message) => logs.push(message),
    });
    const boot = await host.ensureBoot();
    const workspace = tempRoot("ic-route-loader-workspace-");
    const session = await AgentSession.create({
      scope: boot.createSessionScope(),
      spine: boot.spine,
      plugins: await host.composePlugins(workspace),
      provider: createMockProvider({ turns: [{ text: "ok" }] }),
      workspaceRoot: workspace,
      permission: { mode: "auto", decider: { ask: async () => "deny" } },
      logger: (_level, message) => logs.push(message),
    });
    expect(session.registry.tools.has("Read")).toBe(true);
    expect(session.loaderEntries.map((entry) => entry.options.id)).toEqual(
      expect.arrayContaining(["fs", "shell", "todo", "failing", "missing"]),
    );
    expect(logs.join("\n")).toContain("failing");
    expect(logs.join("\n")).toContain("missing");
    await session.dispose();
    await host.disposePluginBoot();
  });
});

if (!existsSync(paths.kernelPath)) {
  it.skip("staging tree not found — build staging artifacts before running route loader integration", () => {});
}
