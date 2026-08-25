import { AgentSession, type AgentSessionOptions } from "../../src";
import type { Delta, Provider } from "@innocenceharness/harness-providers";

export function echoProvider(log: string[] = []): Provider {
  return {
    id: "echo",
    async *chat(req): AsyncIterable<Delta> {
      log.push(req.system);
      yield { type: "text", text: `echo:${req.messages.at(-1)?.parts[0] ?? ""}` };
    },
  };
}

export function testSessionOptions(
  overrides: Partial<AgentSessionOptions> = {},
): AgentSessionOptions {
  return {
    allowStaticSpine: true,
    plugins: [],
    provider: echoProvider(),
    workspaceRoot: "D:/tmp",
    permission: { mode: "auto", decider: { ask: async () => "deny" } },
    ...overrides,
  };
}

export async function createTestSession(
  overrides: Partial<AgentSessionOptions> = {},
): Promise<AgentSession> {
  return AgentSession.create(testSessionOptions(overrides));
}
