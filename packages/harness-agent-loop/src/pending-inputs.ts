import type { Message } from "@innocenceharness/harness-session";

/**
 * One parked steer input: the canonical user message plus opaque host context
 * (the runtime's send request). The loop only ever reads `message`; `data`
 * travels untouched so the host can recover its request when the run settles
 * before draining the entry.
 */
export interface PendingInput {
  message: Message;
  data?: unknown;
}

/**
 * Per-route-session steer mailbox. While a run is active the host pushes user
 * messages (interactionMode "steer"); the loop drains the mailbox at every
 * turn top — after the previous turn's inflight tools settled, before the
 * next model step — and injects each entry as its own user turn. Whatever
 * remains when the run ends belongs to the host again (it becomes an ordinary
 * queued follow-up run). The mailbox carries no run state of its own, so one
 * mailbox can be shared by the session builds of one route.
 */
export interface PendingInputMailbox {
  push(message: Message, data?: unknown): void;
  /** Removes and returns every parked entry, in push order. */
  drain(): PendingInput[];
  size(): number;
}

export function createPendingInputMailbox(): PendingInputMailbox {
  const entries: PendingInput[] = [];
  return {
    push(message, data) {
      entries.push(data === undefined ? { message } : { message, data });
    },
    drain() {
      return entries.splice(0);
    },
    size() {
      return entries.length;
    },
  };
}
