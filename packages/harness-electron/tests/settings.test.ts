import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MOCK_MODEL,
  MOCK_PROFILE_ID,
  PROVIDER_PRESETS,
  listModels,
  mergeSettings,
  newCustomProfile,
  resolveActive,
} from "../src";
import { modelFromPreset } from "../src/modelPresets";

describe("mergeSettings", () => {
  it("garbage input falls back to defaults with presets", () => {
    expect(mergeSettings(null).profiles).toHaveLength(PROVIDER_PRESETS.length);
    expect(mergeSettings(undefined).activeProfileId).toBe(MOCK_PROFILE_ID);
    expect(mergeSettings("junk").permissionMode).toBe("ask");
  });

  it("migrates v1 single-provider settings to v2 profiles", () => {
    const v1 = {
      providerId: "openai",
      openai: { apiKey: "sk-old", baseURL: "https://gw.example/v1", model: "gpt-4o-mini" },
      anthropic: { apiKey: "", model: "claude-sonnet-4-5" },
      workspaceRoot: "D:/work",
      permissionMode: "plan",
    };
    const s = mergeSettings(v1);
    const openai = s.profiles.find((p) => p.name === "OpenAI");
    expect(openai).toMatchObject({
      kind: "openai",
      apiKey: "sk-old",
      baseURL: "https://gw.example/v1",
      enabled: true,
      models: [{ id: "gpt-4o-mini", source: "preset" }],
    });
    // Anthropic had no key -> not migrated as enabled
    expect(s.profiles.find((p) => p.name === "Anthropic")?.enabled).toBe(false);
    expect(s.activeProfileId).toBe(openai!.id);
    expect(s.activeModel).toBe("gpt-4o-mini");
    expect(s.workspaceRoot).toBe("D:/work");
    expect(s.permissionMode).toBe("plan");
  });

  it("v1 with mock providerId keeps mock active", () => {
    const s = mergeSettings({ providerId: "mock" });
    expect(s.activeProfileId).toBe(MOCK_PROFILE_ID);
    expect(s.activeModel).toBe(MOCK_MODEL);
  });

  it("normalizes v2: drops malformed profiles, resets invalid active selection", () => {
    const s = mergeSettings({
      profiles: [
        { id: "a", name: "A", kind: "openai", apiKey: "k", baseURL: "", enabled: true, models: ["m1"] },
        { id: "", name: "bad" },
        { id: "b", kind: "bogus" },
      ],
      activeProfileId: "zzz",
      activeModel: "nope",
      permissionMode: "bogus",
    });
    expect(s.profiles).toHaveLength(2);
    expect(s.profiles[1]).toMatchObject({ id: "b", kind: "openai", enabled: false, models: [] });
    expect(s.activeProfileId).toBe(MOCK_PROFILE_ID);
    expect(s.activeModel).toBe(MOCK_MODEL);
    expect(s.permissionMode).toBe("ask");
  });

  it("round-trips valid v3 settings unchanged", () => {
    const profile = newCustomProfile("我的网关");
    profile.apiKey = "k";
    profile.baseURL = "https://gw/v1";
    profile.models = [
      { id: "x", source: "manual" },
      { id: "y", source: "fetch" },
    ];
    const input = {
      profiles: [profile],
      activeProfileId: profile.id,
      activeModel: "y",
      workspaceRoot: "D:/x",
      permissionMode: "auto" as const,
      themeMode: "dark" as const,
      locale: "zh-CN" as const,
      reasoningEffort: "high" as const,
      activeAgent: "full" as const,
      externalSkillDiscovery: true,
      externalEditorCommand: "code --wait",
    };
    expect(mergeSettings(input)).toEqual(input);
  });

  it("preserves a persisted native profile kind and activates its model", () => {
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

    expect(settings.profiles[0]).toMatchObject({ id: "native", kind: "google" });
    expect(resolveActive(settings)).toMatchObject({ kind: "google", model: "native-model" });
  });

  it("keeps a legacy compatible profile on the compatible kind", () => {
    const settings = mergeSettings({
      profiles: [{
        id: "legacy",
        name: "Legacy compatible",
        kind: "openai",
        apiKey: "secret",
        baseURL: "https://compat.example.invalid/v1",
        enabled: true,
        models: [{ id: "legacy-model", source: "manual" }],
      }],
      activeProfileId: "legacy",
      activeModel: "legacy-model",
    });

    expect(resolveActive(settings)).toMatchObject({ kind: "openai", model: "legacy-model" });
  });

  it("normalizes ui prefs: invalid themeMode/locale fall back to system defaults", () => {
    const s = mergeSettings({
      profiles: [],
      themeMode: "neon",
      locale: "fr-FR",
    });
    expect(s.themeMode).toBe("system");
    expect(s.locale).toBe("");
    expect(mergeSettings({ profiles: [], themeMode: "light", locale: "en-US" })).toMatchObject({
      themeMode: "light",
      locale: "en-US",
    });
  });

  it("reasoningEffort 往返：合法值保留，非法值回落空串", () => {
    expect(mergeSettings({ profiles: [], reasoningEffort: "high" }).reasoningEffort).toBe("high");
    expect(mergeSettings({ profiles: [], reasoningEffort: "ultra" }).reasoningEffort).toBe("");
    expect(mergeSettings({ profiles: [] }).reasoningEffort).toBe("");
  });

  it("permissionMode 含 full（完全访问）往返", () => {
    expect(mergeSettings({ profiles: [], permissionMode: "full" }).permissionMode).toBe("full");
    expect(mergeSettings({ profiles: [], permissionMode: "yolo" }).permissionMode).toBe("ask");
  });

  it("activeAgent 往返：合法值保留，非法/缺失回落 default", () => {
    expect(mergeSettings({ profiles: [], activeAgent: "full" }).activeAgent).toBe("full");
    expect(mergeSettings({ profiles: [], activeAgent: "plan" }).activeAgent).toBe("plan");
    expect(mergeSettings({ profiles: [], activeAgent: "nope" }).activeAgent).toBe("default");
    expect(mergeSettings({ profiles: [] }).activeAgent).toBe("default");
  });

  it("externalSkillDiscovery defaults enabled and normalizes boolean values", () => {
    expect(mergeSettings({ profiles: [] }).externalSkillDiscovery).toBe(true);
    expect(mergeSettings({ profiles: [], externalSkillDiscovery: false }).externalSkillDiscovery).toBe(false);
    expect(mergeSettings({ profiles: [], externalSkillDiscovery: "no" }).externalSkillDiscovery).toBe(true);
  });
  it("pluginToggles 归一化：布尔键保留，非布尔剔除", () => {
    expect(
      mergeSettings({ profiles: [], pluginToggles: { subagent: false, mcp: "yes" } }).pluginToggles,
    ).toEqual({ subagent: false });
  });

  it("pluginToggles 四键布尔往返；全无效/缺失回落 undefined（=默认全开）", () => {
    const toggles = { subagent: true, skills: false, mcp: true, todo: false };
    expect(mergeSettings({ profiles: [], pluginToggles: toggles }).pluginToggles).toEqual(toggles);
    expect(mergeSettings({ profiles: [], pluginToggles: { mcp: "yes", todo: 1 } }).pluginToggles).toBeUndefined();
    expect(mergeSettings({ profiles: [] }).pluginToggles).toBeUndefined();
  });

  it("pluginToggles 无 profiles 分支同样归一化", () => {
    expect(
      mergeSettings({ pluginToggles: { subagent: false, mcp: "yes" } }).pluginToggles,
    ).toEqual({ subagent: false });
  });

  it("pluginToggles 开放键空间（清单派生）：清单内新增插件键（如 example）保留不剔除", () => {
    // 等价升级：原白名单只认四键，example:false 会被静默剔除；键空间清单
    // 派生后写路径透传清单内键（cordis.yml 键在 settings 未保存时仍生效）。
    expect(
      mergeSettings({ profiles: [], pluginToggles: { example: false, todo: true } }).pluginToggles,
    ).toEqual({ example: false, todo: true });
  });
});

describe("settings v3 迁移", () => {
  it("v2 的 string[] models 迁移为对象并 enrich", () => {
    const s = mergeSettings({
      profiles: [
        {
          id: "p1",
          name: "DeepSeek",
          kind: "openai",
          apiKey: "k",
          baseURL: "",
          enabled: true,
          models: ["deepseek-chat", "custom-x"],
        },
      ],
      activeProfileId: "p1",
      activeModel: "deepseek-chat",
      workspaceRoot: "",
      permissionMode: "ask",
    });
    const p = s.profiles.find((x) => x.id === "p1")!;
    expect(p.models[0]).toMatchObject({ id: "deepseek-chat", source: "preset", tools: true });
    expect(p.models[1]).toEqual({ id: "custom-x", source: "manual" });
  });

  it("已是对象的 models 保留字段，dirty 不被重置", () => {
    const s = mergeSettings({
      profiles: [
        {
          id: "p1",
          name: "DeepSeek",
          kind: "openai",
          apiKey: "",
          baseURL: "",
          enabled: true,
          models: [{ id: "deepseek-chat", contextWindow: 999, source: "manual", dirty: true }],
        },
      ],
      activeProfileId: "p1",
      activeModel: "deepseek-chat",
      workspaceRoot: "",
      permissionMode: "ask",
    });
    expect(s.profiles[0]!.models[0]).toMatchObject({ contextWindow: 999, dirty: true });
  });

  it("resolveActive 按 id 匹配", () => {
    const s = mergeSettings({
      profiles: [
        {
          id: "p1",
          name: "DeepSeek",
          kind: "openai",
          apiKey: "k",
          baseURL: "",
          enabled: true,
          models: [modelFromPreset("DeepSeek", "deepseek-chat")],
        },
      ],
      activeProfileId: "p1",
      activeModel: "deepseek-chat",
      workspaceRoot: "",
      permissionMode: "ask",
    });
    expect(resolveActive(s)).toMatchObject({ kind: "openai", model: "deepseek-chat" });
  });
});

describe("resolveActive", () => {
  it("returns mock when nothing valid is active", () => {
    expect(resolveActive(DEFAULT_SETTINGS)).toEqual({ kind: "mock" });
    expect(
      resolveActive({ ...DEFAULT_SETTINGS, activeProfileId: "preset_OpenAI" }),
    ).toEqual({ kind: "mock" }); // preset disabled by default
  });

  it("returns the active profile with its model", () => {
    const s = mergeSettings(DEFAULT_SETTINGS);
    const p = s.profiles[0];
    p.enabled = true;
    p.apiKey = "k";
    const r = resolveActive({
      ...s,
      activeProfileId: p.id,
      activeModel: p.models[0].id,
    });
    expect(r).toEqual({
      kind: p.kind,
      apiKey: "k",
      baseURL: p.baseURL,
      model: p.models[0].id,
    });
  });
});

describe("listModels", () => {
  it("parses OpenAI-style /models responses", async () => {
    const models = await listModels(
      { kind: "openai", apiKey: "k", baseURL: "https://gw/v1" },
      async (url, init) => {
        expect(String(url)).toBe("https://gw/v1/models");
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer k");
        return new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }, { name: "c" }] }));
      },
    );
    expect(models).toEqual(["a", "b", "c"]);
  });

  it("parses Anthropic /v1/models with x-api-key", async () => {
    const models = await listModels(
      { kind: "anthropic", apiKey: "ak", baseURL: "" },
      async (url, init) => {
        expect(String(url)).toBe("https://api.anthropic.com/v1/models");
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("ak");
        return new Response(
          JSON.stringify({ data: [{ id: "claude-sonnet-4-5", display_name: "Sonnet" }] }),
        );
      },
    );
    expect(models).toEqual(["claude-sonnet-4-5"]);
  });

  it("surfaces HTTP errors with status", async () => {
    await expect(
      listModels({ kind: "openai", apiKey: "k", baseURL: "" }, async () =>
        new Response("unauthorized", { status: 401 }),
      ),
    ).rejects.toThrow("HTTP 401");
  });
});
