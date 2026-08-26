import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ProviderModel } from "@innocenceharness/harness-providers";
import { DEFAULT_SETTINGS, mergeSettings, type HarnessSettings } from "@innocenceharness/harness-electron";
import { buildProviderFromSettings, createSessionComposition, resolveStagedProvider } from "./sessionComposition";
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
