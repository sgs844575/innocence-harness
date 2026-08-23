import { textMessage, type Message } from "@innocencecode/harness-session";
import type { RunLoopFunction } from "@innocencecode/harness-agent-loop";
import type { ExecutionScopeIdentity } from "@innocencecode/harness-tools";
import type { SessionKernel } from "./session-kernel";

/** Converts run input into a canonical user message or throws. */
export function canonicalUserMessage(input: string | Message): Message {
  const message = typeof input === "string" ? textMessage("user", input) : input;
  if (message.role !== "user") {
    throw new Error(`AgentSession.run() only accepts user messages (got "${message.role}")`);
  }
  return message;
}

/** Executes message processing and the configured agent loop. */
export async function executeSessionRun(
  kernel: SessionKernel,
  loop: RunLoopFunction,
  canonical: Message,
  runScope: ExecutionScopeIdentity,
  abort: AbortController,
) {
  const processed = await kernel.services.session.processUserInput(canonical, abort.signal);
  return loop(processed, { signal: abort.signal, scope: runScope });
}

/** Waits for an active run, unwinds the kernel, and preserves dispose errors. */
export async function settleSessionKernel(
  kernel: SessionKernel,
  active: Promise<unknown> | undefined,
): Promise<void> {
  if (active) await active.catch(() => {});
  const errors: unknown[] = [];
  try {
    await kernel.ctx.fiber.dispose();
  } catch (error) {
    errors.push(error);
  }
  for (const fiber of kernel.pluginFibers) errors.push(...fiber.unwindErrors);
  if (errors.length > 0) {
    const detail = errors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    throw new AggregateError(errors, `plugin dispose failed: ${detail}`);
  }
}
