// Ask-user bridge (mirror of the permission-ask half of runtimeHooks): the
// host-side implementation of the plugin-ask askUser port. One ask round
// mints a requestId, pushes one ChatQuestionEvent to the renderer, and parks
// in the shared pendingQuestions registry until the renderer answers
// (chat:question-respond), the turn/session is stopped, the app quits, or —
// with questionAutoContinue enabled — the 5-minute skip timer fires. The
// port resolves the plugin's AskUserOutcome: answers -> "answered", every
// other settlement -> "skipped" (the run-signal race inside the tool covers
// the abort classification).
//
// Card-lifecycle invariants (renderer has ONE transient card per session):
//  - asks serialize per session (deps.askQueues tail chaining): a second
//    ask of the same session never overwrites the first pending card — its
//    event is sent only after the prior round settles (subagent children
//    share the parent's port, so their asks queue behind the parent's);
//  - every settlement broadcasts chat:question-settled so the renderer can
//    drop a card that resolved without its help (timer/stop/quit);
//  - the pending entry retains its event payload, so a session re-activation
//    can replay the card (pendingQuestionEvents).
// Electron-free by construction; harnessGlue injects the broadcast/notify
// faces and the messageId resolver.
import type {
  ChatQuestionEvent,
  ChatQuestionResponse,
} from "../shared/ipc";
import {
  ASK_USER_TOOL_NAME,
  type AskUserItem,
  type AskUserOutcome,
  type AskUserPort,
} from "@innocenceharness/plugin-ask";
import { QUESTION_AUTO_CONTINUE_TIMEOUT_MS } from "./runtimeHooks";

export interface PendingQuestion {
  sessionId: string;
  /** The exact event the card rendered from (replay on re-activation). */
  event: ChatQuestionEvent;
  finish: (response: ChatQuestionResponse) => void;
}

export type PendingQuestionRegistry = Map<string, PendingQuestion>;

/** Per-session ask serialization tails (shared, like the registry). */
export type AskUserQueueRegistry = Map<string, Promise<void>>;

/** Stop/dispose: every pending question of the session settles as skipped. */
export function cancelPendingQuestions(
  pendingQuestions: PendingQuestionRegistry,
  sessionId: string,
): void {
  for (const pending of pendingQuestions.values()) {
    if (pending.sessionId === sessionId) pending.finish(null);
  }
}

/** App shutdown: no question may block on a card that will never be answered. */
export function rejectPendingQuestions(pendingQuestions: PendingQuestionRegistry): void {
  for (const pending of pendingQuestions.values()) pending.finish(null);
  pendingQuestions.clear();
}

/** Pending cards of one session, oldest first (replay on re-activation). */
export function pendingQuestionEvents(
  pendingQuestions: PendingQuestionRegistry,
  sessionId: string,
): ChatQuestionEvent[] {
  const events: ChatQuestionEvent[] = [];
  for (const pending of pendingQuestions.values()) {
    if (pending.sessionId === sessionId) events.push(pending.event);
  }
  return events;
}

/** Host dependencies the port needs (all injected; keeps this module testable). */
export interface AskUserPortDeps {
  /** Shared pending-question registry the respond port resolves through. */
  pendingQuestions: PendingQuestionRegistry;
  /** Shared per-session ask queue tails (one card per session at a time). */
  askQueues: AskUserQueueRegistry;
  /** Broadcast face (main-window webContents.send of the chat:question event). */
  send(event: ChatQuestionEvent): void;
  /** Settlement notice face (chat:question-settled { requestId }). */
  sendSettled(requestId: string): void;
  /** Best-effort assistant message id of the asking turn (card correlation). */
  resolveMessageId(sessionId: string): string;
  /** questionAutoContinue snapshot read at ask time (timer vs no timeout). */
  questionAutoContinue(): boolean;
  /** Optional desktop notify face (same "permission" kind as permission asks). */
  notify?(sessionId: string): void;
}

/** Identity of the route session the port is bound to. */
export interface AskUserIdentity {
  sessionId: string;
  routeId: string;
}

let askSeq = 0;
const nextRequestId = (): string =>
  `ask_${Date.now().toString(36)}_${(askSeq++).toString(36)}`;

/** Maps the plugin's pure question shape onto the IPC mirror shape. */
function toEventQuestions(questions: readonly AskUserItem[]): ChatQuestionEvent["questions"] {
  return questions.map((item) => ({
    question: item.question,
    ...(item.header !== undefined ? { header: item.header } : {}),
    options: item.options.map((option) => ({
      label: option.label,
      ...(option.description !== undefined ? { description: option.description } : {}),
    })),
    ...(item.multiSelect !== undefined ? { multiSelect: item.multiSelect } : {}),
  }));
}

/**
 * Creates the askUser port for one route session. Ask rounds of the SAME
 * session serialize on the shared queue tail (the renderer shows one card at
 * a time); a round registers in the shared registry and broadcasts its event
 * only once it is that session's turn. Settlements resolve the promise, drop
 * the registry entry and broadcast chat:question-settled; a late/duplicate
 * response for a settled request is an idempotent no-op.
 */
export function createAskUserPort(deps: AskUserPortDeps, identity: AskUserIdentity): AskUserPort {
  const askRound = async (questions: AskUserItem[]): Promise<AskUserOutcome> => {
    const requestId = nextRequestId();
    const event: ChatQuestionEvent = {
      sessionId: identity.sessionId,
      messageId: deps.resolveMessageId(identity.sessionId),
      requestId,
      toolName: ASK_USER_TOOL_NAME,
      questions: toEventQuestions(questions),
    };
    const response = await new Promise<ChatQuestionResponse>((resolve) => {
      let settled = false;
      const finish = (value: ChatQuestionResponse) => {
        if (settled) return;
        settled = true;
        deps.pendingQuestions.delete(requestId);
        if (timer !== undefined) clearTimeout(timer);
        resolve(value);
        deps.sendSettled(requestId);
      };
      // questionAutoContinue 开启：5 分钟未答自动按跳过落定——循环带着跳过
      // 结果继续前进；关闭：不设定时器，一直等待用户作答。取值以提问发起
      // 时的设置快照为准（与权限询问同一语义）。
      const timer = deps.questionAutoContinue() === true
        ? setTimeout(() => finish(null), QUESTION_AUTO_CONTINUE_TIMEOUT_MS)
        : undefined;
      deps.pendingQuestions.set(requestId, {
        sessionId: identity.sessionId,
        event,
        finish,
      });
      deps.send(event);
      deps.notify?.(identity.sessionId);
    });
    // 渲染层应答 null = 用户跳过/取消/会话停止——插件把非作答落定一律折叠
    // 为 skipped（工具侧另行以运行信号竞速归类中止）。
    if (response === null) return { status: "skipped" };
    return { status: "answered", answers: response.answers };
  };

  return async (questions: AskUserItem[]): Promise<AskUserOutcome> => {
    const previous = deps.askQueues.get(identity.sessionId) ?? Promise.resolve();
    const round = previous.then(() => askRound(questions));
    // 尾链吞错：后继轮次不因前一轮的异常卡死；自身错误由 round 持有者处理。
    const tail = round.then(
      () => undefined,
      () => undefined,
    );
    deps.askQueues.set(identity.sessionId, tail);
    void tail.then(() => {
      if (deps.askQueues.get(identity.sessionId) === tail) {
        deps.askQueues.delete(identity.sessionId);
      }
    });
    return round;
  };
}
