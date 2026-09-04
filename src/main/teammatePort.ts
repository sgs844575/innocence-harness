// Teammate port (batch 4E task 1): the host-side implementation of the
// plugin-team sendToTeammate port. A teammate NAME is a named route of the
// sending session's task (the route DAG of task-core; the sending route
// itself is excluded). Delivery runs one envelope-carrying turn on that
// route through the HarnessRuntime send face and collects the teammate's
// reply through the automation reply observer — runtime.send awaits the
// whole turn but returns no text, while the runtime hooks mirror every
// delta of the minted message id (the same collection pattern the
// automation loop dispatch uses); host-mirrored notice rows (compaction /
// non-fatal warnings) are stripped from the collected text — they are not
// the teammate's own words (ownReplyText, shared with that dispatch). Busy
// guard: the runtime runs one turn per
// route at a time; a route whose turn is already running is refused
// fail-fast instead of corrupting it with a second concurrent run (a route
// mid-turn awaiting a teammate reply is exactly the mutual-send deadlock —
// the envelope teaches teammates to answer as turn text instead).
// Electron-free by construction; harnessGlue injects the runtime and the
// task-bridge route lister.
import { buildTeammateTurn, TEAMMATE_EMPTY_REPLY, type SendToTeammatePort, type TeamSendResult } from "@innocenceharness/plugin-team";
import { beginObservedReply, endObservedReply, ownReplyText } from "./automationReplyObserver";

/** The runtime faces the port needs (structurally satisfied by HarnessRuntime). */
export interface TeammateRuntimePort {
  send(input: {
    sessionId: string;
    taskId: string;
    routeId: string;
    text: string;
    messageId: string;
  }): Promise<void>;
  /** Present when the runtime exposes its one-turn-per-route busy state. */
  isRouteRunning?(sessionId: string, routeId: string): boolean;
}

/** Host dependencies: the runtime send face and the task's route names. */
export interface TeammatePortDeps {
  runtime: TeammateRuntimePort;
  /** Route ids of the task (the teammate namespace); empty = no teammates. */
  listTeammateRoutes(taskId: string): Promise<readonly string[]>;
}

/** Identity of the sending route session the port is bound to. */
export interface TeammateIdentity {
  sessionId: string;
  routeId: string;
  /** Task the sending route belongs to; absent = plain chat, no teammates. */
  taskId?: string;
}

const NO_TASK_ERROR =
  "No named teammates are available in this session (it is not bound to a task); use the one-shot subagent tool instead.";
const withMessage = (error: string, message: string) => `${error} Message: ${message}`;

let teamSeq = 0;
const mintMessageId = (routeId: string) =>
  `team_${routeId}_${Date.now().toString(36)}_${(teamSeq++).toString(36)}`;

/**
 * Creates the sendToTeammate port for one sending route session. Resolution
 * and refusal checks are synchronous with delivery start (no await between
 * the busy check and the runtime's run registration), so the guard is
 * race-free on the single-threaded loop.
 */
export function createSendToTeammate(
  deps: TeammatePortDeps,
  identity: TeammateIdentity,
): SendToTeammatePort {
  return async (teammate: string, message: string): Promise<TeamSendResult> => {
    if (!identity.taskId) return { ok: false, error: withMessage(NO_TASK_ERROR, message) };
    const routes = await deps.listTeammateRoutes(identity.taskId);
    const others = routes.filter((routeId) => routeId !== identity.routeId);
    if (!routes.includes(teammate)) {
      return {
        ok: false,
        error: withMessage(others.length > 0
          ? `Unknown teammate "${teammate}"; available teammates: ${others.join(", ")}.`
          : `Unknown teammate "${teammate}"; this task has no other named routes.`, message),
      };
    }
    if (teammate === identity.routeId) {
      return {
        ok: false,
        error: withMessage("A route cannot send a message to itself; address a different teammate.", message),
      };
    }
    if (deps.runtime.isRouteRunning?.(identity.sessionId, teammate)) {
      return {
        ok: false,
        error: withMessage(`Teammate "${teammate}" is busy running another turn; wait for that turn to finish before sending again (a teammate answers as its turn text — it does not need a message back).`, message),
      };
    }
    const messageId = mintMessageId(identity.routeId);
    beginObservedReply(messageId);
    let reply;
    try {
      await deps.runtime.send({
        sessionId: identity.sessionId,
        taskId: identity.taskId,
        routeId: teammate,
        text: buildTeammateTurn(message),
        messageId,
      });
      reply = endObservedReply(messageId);
    } catch (err) {
      // Defensive: runtime.send never rejects in practice (failures flow
      // through onError); release the observer entry on the port path anyway.
      endObservedReply(messageId);
      return {
        ok: false,
        error: `Teammate delivery failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // 错误标记优先：失败回合即使镜像了文本也判为投递失败。
    if (reply.errored) {
      return {
        ok: false,
        error: reply.error ?? (reply.text || "The teammate turn failed before producing a reply."),
      };
    }
    // 剥离宿主镜像的通知行（runtime-events 把压缩/非致命错误以
    // "> 🗜️/⚠️" 合成 delta 送进 onDelta——它们不是队友自述文本）；
    // 剥离后为空（无正文但触发压缩的回合）回落占位符。
    const own = ownReplyText(reply.text).trim();
    return { ok: true, reply: own.length > 0 ? own : TEAMMATE_EMPTY_REPLY };
  };
}
