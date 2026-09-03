import type { Provider } from "@innocenceharness/harness-providers";
import type { Message } from "./types";

export interface MessageProcessorContext {
  signal: AbortSignal;
  provider: Provider;
  scope: {
    sessionId: string;
  };
  /**
   * Optional read-only view of the session's stored messages. The host that
   * runs the pipeline derives it from its real history storage (the session
   * spine returns a fresh snapshot per call). Optional on purpose: hosts and
   * test fakes that keep no ledger omit it, and processors must read a
   * missing accessor as "history unavailable", never as "empty history".
   */
  history?: () => readonly Message[];
}

export interface MessageProcessor {
  name: string;
  order: number;
  /**
   * False = parent-session only: the spawner drops it from the processor set
   * inherited by subagent children. Parent-scoped processors (for example a
   * subagent progress drain) must opt out — a child's first input would
   * otherwise consume the parent's pending notes.
   */
  inheritToSubagents?: boolean;
  process(message: Message, context: MessageProcessorContext): Promise<Message>;
}

export async function processMessage(
  message: Message,
  processors: readonly MessageProcessor[],
  context: MessageProcessorContext,
): Promise<Message> {
  const ordered = processors
    .map((processor, index) => ({ processor, index }))
    .sort((a, b) => a.processor.order - b.processor.order || a.index - b.index);

  let current = message;
  for (const { processor } of ordered) {
    current = await processor.process(current, context);
  }
  return current;
}
