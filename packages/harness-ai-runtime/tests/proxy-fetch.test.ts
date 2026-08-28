import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveModelFetch,
  resetModelProxyDispatcher,
  type ModelFetchOptions,
} from "../src/proxy-fetch";

const PROXY_ENV = { env: { HTTPS_PROXY: "http://127.0.0.1:7890" } } as unknown as ModelFetchOptions;

function withProxyEnv(run: () => void): void {
  const saved = { ...process.env };
  process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
  try {
    run();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}

afterEach(() => resetModelProxyDispatcher());

describe("resolveModelFetch", () => {
  it("prefers an explicitly injected fetch", () => {
    const fetchImpl = (async () => new Response(null)) as typeof fetch;
    expect(resolveModelFetch({ fetchImpl }).fetch).toBe(fetchImpl);
  });

  it("attaches nothing when the environment declares no proxy", () => {
    expect(resolveModelFetch({ env: {} }).fetch).toBeUndefined();
    expect(resolveModelFetch({}).fetch).toBeUndefined();
  });

  it("routes through an env-aware proxy dispatcher when proxy settings exist", () => {
    const agentFactory = vi.fn(() => ({}) as never);
    const resolved = resolveModelFetch({ ...PROXY_ENV, agentFactory });
    expect(resolved.fetch).toBeDefined();
    expect(resolved.fetch).not.toBe(globalThis.fetch);
    expect(agentFactory).toHaveBeenCalledTimes(1);
  });

  it("memoizes one proxy dispatcher per environment fingerprint", () => {
    const agentFactory = vi.fn(() => ({}) as never);
    resolveModelFetch({ ...PROXY_ENV, agentFactory });
    resolveModelFetch({ ...PROXY_ENV, agentFactory });
    expect(agentFactory).toHaveBeenCalledTimes(1);

    resetModelProxyDispatcher();
    resolveModelFetch({ ...PROXY_ENV, agentFactory });
    expect(agentFactory).toHaveBeenCalledTimes(2);
  });

  it("follows live process proxy settings for the default transport", () => {
    withProxyEnv(() => {
      const resolved = resolveModelFetch({});
      expect(resolved.fetch).toBeDefined();
      expect(resolved.fetch).not.toBe(globalThis.fetch);
    });
    expect(resolveModelFetch({}).fetch).toBeUndefined();
  });
});
