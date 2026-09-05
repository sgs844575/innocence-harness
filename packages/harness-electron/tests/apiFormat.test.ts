import { describe, expect, it } from "vitest";
import { mergeSettings, resolveActive, listModels } from "../src/settings";

describe("API format settings", () => {
  const profile = { id: "gateway", name: "Gateway", kind: "openai", enabled: true, apiKey: "secret", baseURL: "https://example.invalid/v1", models: [{ id: "model" }] };
  it.each(["messages", "responses", "chat-completions", "native-generative"])("preserves %s across persistence", (apiFormat) => {
    const settings = mergeSettings({ profiles: [{ ...profile, apiFormat }], activeProfileId: profile.id, activeModel: "model" });
    expect(mergeSettings(JSON.parse(JSON.stringify(settings))).profiles[0].apiFormat).toBe(apiFormat);
    expect(resolveActive(settings).kind).toBe(apiFormat === "messages" ? "anthropic" : apiFormat === "native-generative" ? "google" : "openai");
  });
  it("discards unknown formats and preserves legacy routing", () => {
    const settings = mergeSettings({ profiles: [{ ...profile, apiFormat: "bad" }], activeProfileId: profile.id, activeModel: "model" });
    expect(settings.profiles[0].apiFormat).toBeUndefined();
    expect(resolveActive(settings).kind).toBe("openai");
  });
  it("uses the selected format for model discovery without duplicating the version", async () => {
    let request: { url: unknown; headers: unknown } | undefined;
    await listModels({ ...profile, kind: "openai", apiFormat: "messages" }, (async (url, init) => {
      request = { url, headers: init?.headers };
      return new Response(JSON.stringify({ data: [] }));
    }) as typeof fetch);
    expect(request?.url).toBe("https://example.invalid/v1/models");
    expect(request?.headers).toHaveProperty("x-api-key", "secret");
  });
});
