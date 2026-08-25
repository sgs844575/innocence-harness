import { describe, expect, it, vi } from "vitest";
import type { ProviderModel } from "@innocenceharness/harness-providers";
import { createGooglePlugin, createGoogleProvider } from "../src/index";

describe("Native model factory", () => {
  it("creates a native Google model through the shared runtime factory", () => {
    const model: ProviderModel = {
      value: { opaque: true },
      providerId: "google-native",
      modelId: "gemini-2.5-pro",
    };
    const create = vi.fn(() => model);
    const fetchImpl = vi.fn();

    const result = createGoogleProvider(
      {
        apiKey: "secret",
        id: "google-native",
        baseURL: "https://mirror.example.invalid/v1beta",
        model: "gemini-2.5-pro",
        temperature: 0.3,
        maxTokens: 4096,
        fetchImpl,
      },
      { create } as never,
    );

    expect(create).toHaveBeenCalledWith({
      providerId: "google-native",
      protocol: "google",
      modelId: "gemini-2.5-pro",
      credential: "secret",
      baseURL: "https://mirror.example.invalid/v1beta",
      fetchImpl,
      requestOptions: {
        temperature: 0.3,
        maxTokens: 4096,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toBe(model);
  });

  it("fails closed before model creation when no credential is available", () => {
    const previous = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const create = vi.fn();

    try {
      expect(() => createGoogleProvider({ model: "m" }, { create } as never)).toThrow("API key");
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previous;
    }
  });

  it("exposes a factory-shaped default plugin export for dynamic staging resolution", () => {
    expect(typeof createGooglePlugin).toBe("function");
  });
});
