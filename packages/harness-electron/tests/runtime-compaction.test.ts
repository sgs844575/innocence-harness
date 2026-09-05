import { expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, HarnessRuntime, staticSpineSuite } from "../src";
import { createMockProvider } from "@innocenceharness/provider-mock";

it("injects the selected window through the staged spine and refreshes after settings changes", async () => {
  const suite = staticSpineSuite();
  const createSessionPlugin = vi.fn(suite.session.createSessionPlugin);
  let window = 100_000;
  const runtime = new HarnessRuntime({
    settings: () => ({
      ...DEFAULT_SETTINGS,
      activeProfileId: "configured",
      activeModel: "configured-model",
      profiles: [{
        id: "configured", name: "Configured", kind: "openai" as const,
        apiKey: "", baseURL: "", enabled: true,
        models: [{ id: "configured-model", contextWindow: window, source: "manual" as const }],
      }],
    }),
    pluginsForSession: () => [],
    providerFactory: () => createMockProvider({ turns: [{ text: "Done." }] }),
    sessionSpine: () => ({ ...suite, session: { ...suite.session, createSessionPlugin } }),
    hooks: {
      onDelta() {}, onThinking() {}, onTool() {}, onCompleted() {},
      onError: (_s, _m, e) => { throw new Error(String(e)); },
      askPermission: async () => "allow", log() {},
    },
  });
  try {
    await runtime.send({ sessionId: "window-test", taskId: "", routeId: "main", text: "Hello", messageId: "first" });
    expect(createSessionPlugin.mock.calls.at(-1)?.[0].compaction).toEqual({ contextWindow: 100_000 });
    window = 200_000;
    await runtime.send({ sessionId: "window-test", taskId: "", routeId: "main", text: "Continue", messageId: "second" });
    expect(createSessionPlugin.mock.calls.at(-1)?.[0].compaction).toEqual({ contextWindow: 200_000 });
  } finally {
    await runtime.disposeAll();
  }
});
