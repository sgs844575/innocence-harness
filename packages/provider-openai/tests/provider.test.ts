import { describe, expect, it, vi } from "vitest";
import type { ProviderModel } from "@innocenceharness/harness-providers";
import { createOpenAIProvider } from "../src/index";

describe("Compatible model factory", () => {
  it("passes a custom base URL through the shared runtime factory without invoking test fetch", () => {
    const model: ProviderModel = {
      value: { opaque: true },
      providerId: "gateway",
      modelId: "gemini-2.5-pro",
    };
    const create = vi.fn(() => model);
    const fetchImpl = vi.fn();

    const result = createOpenAIProvider(
      {
        apiKey: "secret",
        id: "gateway",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-2.5-pro",
        fetchImpl,
      },
      { create } as never,
    );

    expect(create).toHaveBeenCalledWith({
      providerId: "gateway",
      protocol: "openai-compatible",
      modelId: "gemini-2.5-pro",
      credential: "secret",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toBe(model);
  });

  it("fails closed before model creation when no credential is available", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const create = vi.fn();

    try {
      expect(() => createOpenAIProvider({ model: "m" }, { create } as never)).toThrow("API key");
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});
