import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ProviderModel } from "@innocenceharness/harness-providers";
import { DEFAULT_SETTINGS, mergeSettings, WORKTREE_ISOLATION_FRAGMENT, type HarnessSettings } from "@innocenceharness/harness-electron";
import { buildProviderFromSettings, createSessionComposition, projectAgentModes, resolveStagedProvider, workbenchFocusPlugin, worktreeIsolationPlugin } from "./sessionComposition";
import type { PluginDescriptor } from "../plugin-toggles-local";
import { stagingBootPaths } from "../staging-paths";

function settingsFor(profile: HarnessSettings["profiles"][number]): HarnessSettings {
  return {
    ...DEFAULT_SETTINGS,
    profiles: [profile],
    activeProfileId: profile.id,
    activeModel: profile.models[0]!.id,
  };
}

function model(providerId: string, modelId: string): ProviderModel {
  return { value: { opaque: true }, providerId, modelId };
}

describe("buildProviderFromSettings", () => {
  it("resolves a legacy compatible profile through the staged compatible factory", async () => {
    const create = vi.fn(() => model("legacy-gemini", "gemini-2.5-pro"));
    const importPlugin = vi.fn(async () => create);

    const provider = await buildProviderFromSettings(
      { importPlugin } as never,
      settingsFor({
        id: "legacy-gemini",
        name: "Legacy compatible",
        kind: "openai",
        apiKey: "secret",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
        enabled: true,
        models: [{ id: "gemini-2.5-pro", source: "manual" }],
      }),
    );

    expect(importPlugin).toHaveBeenCalledWith("provider-openai");
    expect(create).toHaveBeenCalledWith({
      id: "legacy-gemini",
      apiKey: "secret",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-pro",
      reasoningEffort: undefined,
    });
    if (!("model" in provider)) throw new Error("expected a staged model provider");
    expect(provider.model).toEqual(model("legacy-gemini", "gemini-2.5-pro"));
  });
  it("resolves a persisted native profile through the staged native factory", async () => {
    const create = vi.fn(() => model("native", "native-model"));
    const importPlugin = vi.fn(async () => create);
    const settings = mergeSettings({
      profiles: [{
        id: "native",
        name: "Native",
        kind: "google",
        apiKey: "secret",
        baseURL: "https://mirror.example.invalid/v1beta",
        enabled: true,
        models: [{ id: "native-model", source: "manual" }],
      }],
      activeProfileId: "native",
      activeModel: "native-model",
    });

    const provider = await buildProviderFromSettings({ importPlugin } as never, settings);

    expect(importPlugin).toHaveBeenCalledWith("provider-google");
    expect(create).toHaveBeenCalledWith({
      id: "native",
      apiKey: "secret",
      baseURL: "https://mirror.example.invalid/v1beta",
      model: "native-model",
      reasoningEffort: undefined,
    });
    if (!("model" in provider)) throw new Error("expected a staged model provider");
    expect(provider.model).toEqual(model("native", "native-model"));
  });

});

describe("resolveStagedProvider", () => {
  it("resolves a native profile through the staged native factory", async () => {
    const create = vi.fn(() => model("google-native", "gemini-2.5-pro"));
    const importPlugin = vi.fn(async () => create);

    const provider = await resolveStagedProvider(
      { importPlugin } as never,
      {
        id: "google-native",
        kind: "google",
        apiKey: "secret",
        baseURL: "https://mirror.example.invalid/v1beta",
        model: "gemini-2.5-pro",
      },
    );

    expect(importPlugin).toHaveBeenCalledWith("provider-google");
    expect(create).toHaveBeenCalledWith({
      id: "google-native",
      apiKey: "secret",
      baseURL: "https://mirror.example.invalid/v1beta",
      model: "gemini-2.5-pro",
      reasoningEffort: undefined,
    });
    expect(provider.model).toEqual(model("google-native", "gemini-2.5-pro"));
  });
});

describe("projectAgentModes (agents:modes catalog projection)", () => {
  const mode = (id: string, title?: string): PluginDescriptor => ({
    id,
    dependencies: [],
    ...(title ? { title } : {}),
    kind: "agent-mode",
  });
  const plain = (id: string): PluginDescriptor => ({ id, dependencies: [] });

  it("merges manifest and scanned descriptors with manifest priority, agent-mode kind only", () => {
    const manifest = [mode("builtin-mode", "Manifest Default"), plain("fs"), mode("custom", "Manifest Custom")];
    const user = [mode("custom", "User Custom"), mode("my-mode", "My Mode"), plain("user-tool")];
    const modes = projectAgentModes(manifest, user);
    expect(modes.map((m) => m.id)).toEqual(["builtin-mode", "custom", "my-mode", "default"]);
    // 同 id 冲突：manifest 条目胜出（title 取 manifest 描述符）。
    expect(modes.find((m) => m.id === "custom")?.title).toBe("Manifest Custom");
    expect(modes.find((m) => m.id === "my-mode")?.title).toBe("My Mode");
  });

  it("falls back to the descriptor id when no title is present", () => {
    const modes = projectAgentModes([mode("untitled")], []);
    expect(modes.find((m) => m.id === "untitled")?.title).toBe("untitled");
  });

  it("always contains the default fallback entry", () => {
    expect(projectAgentModes([], [])).toEqual([{ id: "default", title: "Default" }]);
  });

  it("keeps an explicit default descriptor instead of appending a duplicate", () => {
    const modes = projectAgentModes([mode("default", "Built-in Default")], [mode("extra")]);
    expect(modes.filter((m) => m.id === "default")).toHaveLength(1);
    expect(modes.find((m) => m.id === "default")?.title).toBe("Built-in Default");
  });
});

const paths = stagingBootPaths();
const maybeDescribeStaging = existsSync(paths.kernelPath) ? describe : describe.skip;

maybeDescribeStaging("staged model provider resolution", () => {
  it.each([
    ["provider-openai", "createOpenAIProvider"],
    ["provider-anthropic", "createAnthropicProvider"],
    ["provider-google", "createGoogleProvider"],
  ] as const)("imports the %s factory from staged resources without the node trace adapter", async (pluginId, exportName) => {
    const fixture = mkdtempSync(path.join(tmpdir(), "ic-staged-provider-"));
    try {
      const resources = path.join(fixture, "resources");
      cpSync(path.dirname(paths.builtinRoot), resources, { recursive: true });
      rmSync(path.join(resources, "node_modules", "@opentelemetry", "sdk-trace-node"), { recursive: true, force: true });
      const entry = path.join(resources, "plugins", pluginId, "dist", "index.js");
      const module = await import(pathToFileURL(entry).href) as Record<string, unknown>;

      expect(typeof module[exportName]).toBe("function");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("loads a legacy compatible profile through the staged runtime without a transport fallback", async () => {
    const composition = createSessionComposition({
      resolvePaths: () => paths,
      getWorkspaceRoot: () => undefined,
      enableHmrWatcher: false,
      log: () => {},
    });
    try {
      const provider = await buildProviderFromSettings(
        await composition.ensureBoot(),
        settingsFor({
          id: "legacy-gemini",
          name: "Legacy compatible",
          kind: "openai",
          apiKey: "secret",
          baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
          enabled: true,
          models: [{ id: "gemini-2.5-pro", source: "manual" }],
        }),
      );

      if (!("model" in provider)) throw new Error("expected a staged model provider");
      expect(provider.model).toMatchObject({
        providerId: "legacy-gemini",
        modelId: "gemini-2.5-pro",
      });
      await expect(async () => {
        for await (const _ of provider.chat({ system: "", messages: [], tools: [] })) {
          break;
        }
      }).rejects.toThrow("Model execution is unavailable");
    } finally {
      await composition.disposePluginBoot();
    }
  });
});

describe("worktree isolation notes (S2a)", () => {
  it("registers the fragment only when the session surface is a task worktree", async () => {
    const registered: unknown[] = [];
    const ctx = { systemPrompt: { registerFragment: (fragment: unknown) => registered.push(fragment) } };
    await worktreeIsolationPlugin(true).apply(ctx as never);
    expect(registered).toHaveLength(1);
    registered.length = 0;
    await worktreeIsolationPlugin(false).apply(ctx as never);
    expect(registered).toHaveLength(0);
  });

  it("fragment carries the isolation cores: boundary, finish commit, history safety, staleness", () => {
    expect(WORKTREE_ISOLATION_FRAGMENT.id).toBe("shared.worktree.isolation");
    const text = WORKTREE_ISOLATION_FRAGMENT.render({ activeMode: "default", traits: {} });
    expect(text).toContain("isolated worktree");
    expect(text).toContain("out of bounds");
    expect(text).toContain("coherent commit");
    expect(text).toContain("Never rewrite history");
    expect(text).toContain("re-read a file before editing");
  });
});

describe("workbench focus notes (S4)", () => {
  type Invocation = {
    toolName: string;
    persistedArgs: Record<string, unknown>;
    scope: { sessionId?: string };
  };

  async function runMiddleware(
    plugin: ReturnType<typeof workbenchFocusPlugin>,
    invocation: Invocation,
  ): Promise<{ content: string; isError?: boolean }> {
    const registered: Array<{ name: string; execute: (i: never, next: () => Promise<{ content: string; isError?: boolean }>) => Promise<{ content: string; isError?: boolean }> }> = [];
    const ctx = {
      tools: { registerMiddleware: (m: { name: string; execute: unknown }) => registered.push(m as never) },
    };
    plugin.apply(ctx as never);
    expect(registered).toHaveLength(1);
    return registered[0]!.execute(invocation as never, async () => ({ content: "BODY" }));
  }

  it("appends the focus note when the Read hits the focused file of the same session", async () => {
    let focus: import("./sessionComposition").WorkbenchFocusInput | undefined = {
      sessionId: "s1",
      file: "src/a.ts",
      line: 12,
    };
    const plugin = workbenchFocusPlugin(() => focus);
    const result = await runMiddleware(plugin, {
      toolName: "Read",
      persistedArgs: { path: "D:/repo/src/a.ts" },
      scope: { sessionId: "s1" },
    });
    expect(result.content).toContain("BODY");
    expect(result.content).toContain("工作台焦点注记");
    expect(result.content).toContain("第 12 行");

    focus = {
      sessionId: "s1",
      file: "src/a.ts",
      diagnostics: [{ code: 2322, line: 8, column: 3, message: "Type mismatch" }],
    };
    const diagnosed = await runMiddleware(plugin, {
      toolName: "Read",
      persistedArgs: { path: "src/a.ts" },
      scope: { sessionId: "s1" },
    });
    expect(diagnosed.content).toContain("新诊断注记");
    expect(diagnosed.content).toContain("TS2322 第 8:3 行");

    // 会话不匹配：焦点属于别的会话，不附注。
    const other = await runMiddleware(plugin, {
      toolName: "Read",
      persistedArgs: { path: "src/a.ts" },
      scope: { sessionId: "s2" },
    });
    expect(other.content).toBe("BODY");

    // 焦点消失：零行为。
    focus = undefined;
    const none = await runMiddleware(plugin, {
      toolName: "Read",
      persistedArgs: { path: "src/a.ts" },
      scope: { sessionId: "s1" },
    });
    expect(none.content).toBe("BODY");
  });

  it("non-Read tools and error results never carry the note", async () => {
    const plugin = workbenchFocusPlugin(() => ({ sessionId: "s1", file: "src/a.ts" }));
    const grep = await runMiddleware(plugin, {
      toolName: "Grep",
      persistedArgs: { pattern: "a" },
      scope: { sessionId: "s1" },
    });
    expect(grep.content).toBe("BODY");
  });
});
