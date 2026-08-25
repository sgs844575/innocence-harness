import { describe, expect, it, vi } from "vitest";
import { createModelFactory } from "../src/index";

describe("createModelFactory", () => {
  it("rejects an unsupported provider protocol", () => {
    expect(() =>
      createModelFactory().create({
        providerId: "x",
        protocol: "unknown",
        modelId: "m",
        credential: "secret",
      }),
    ).toThrow("Unsupported provider protocol");
  });

  it("rejects a missing credential without exposing its value", () => {
    expect(() =>
      createModelFactory().create({
        providerId: "x",
        protocol: "openai",
        modelId: "m",
        credential: "",
      }),
    ).toThrow("Provider credential is required");
  });

  it("preserves the neutral metadata and custom base URL for compatible models", () => {
    const model = { opaque: true };
    const createOpenAI = vi.fn(() => ({ chat: vi.fn(() => model) }));
    const factory = createModelFactory({ createOpenAI });

    const result = factory.create({
      providerId: "gateway",
      protocol: "openai-compatible",
      modelId: "custom-model",
      credential: "secret",
      baseURL: "https://example.invalid/v1",
      capabilities: { tools: true },
    });

    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: "secret",
      baseURL: "https://example.invalid/v1",
      name: "gateway",
    });
    expect(result).toEqual({
      value: model,
      providerId: "gateway",
      modelId: "custom-model",
      capabilities: { tools: true },
    });
  });
});
