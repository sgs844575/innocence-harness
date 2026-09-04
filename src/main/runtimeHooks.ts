// Runtime UI-bridge hooks (split out of harnessGlue by responsibility): the
// HarnessRuntime hook bundle that mirrors agent events into the session
// store and the renderer (deltas, structured tool parts, thinking,
// completion, errors) plus the permission-ask bridge that surfaces an ask as
// a renderer dialog (questionAutoContinue 开启时带 5 分钟自动拒绝兜底，
// 关闭时一直等待用户回答).
import type { BrowserWindow } from "electron";
import type { ContextUsageSnapshot } from "@innocenceharness/harness-context-meter";
import type { RuntimeHooks } from "@innocenceharness/harness-electron";
import {
  IPC,
  appendText,
  type ChatCompletionMetadata,
  type ChatContextUsageEvent,
  type ChatContextUsageSnapshot,
  type ChatPermissionEvent,
  type ChatToolEvent,
  type PermissionChoice,
} from "../shared/ipc";
import * as sessions from "./sessions";
import { appendObservedReplyDelta, markObservedReplyError } from "./automationReplyObserver";
import { getMainWindow } from "./appWindow";
import { logger } from "./logger";
import type { DesktopNotifyKind } from "./desktopNotify";

/** 回合事件桌面通知口（harnessGlue 注入；完成/失败/权限请求三类）。 */
export type TurnEventNotify = (
  kind: DesktopNotifyKind,
  sessionId: string,
  options?: { aborted?: boolean },
) => void;

/** questionAutoContinue 开启时：提问 5 分钟未答自动按拒绝落定（自动继续）。 */
export const QUESTION_AUTO_CONTINUE_TIMEOUT_MS = 5 * 60 * 1000;

function send(channel: string, payload: unknown): void {
  const win: BrowserWindow | undefined = getMainWindow() ?? undefined;
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

export interface PendingPermission {
  sessionId: string;
  finish: (choice: PermissionChoice) => void;
}

export type PendingPermissionRegistry = Map<string, PendingPermission>;

export function cancelPendingAsks(pendingAsks: PendingPermissionRegistry, sessionId: string): void {
  for (const pending of pendingAsks.values()) {
    if (pending.sessionId === sessionId) pending.finish("deny");
  }
}

/**
 * Builds the runtime hook bundle. `pendingAsks` is the shared ask registry
 * the host's respondPermission port resolves through (see harnessGlue).
 * `notifyTurnEvent`（可选）是桌面通知口：回合完成/失败与权限请求在同一事
 * 件流上顺带触发，不另起监听。`questionAutoContinue`（可选）现读设置快照：
 * 返回 true 时提问挂 5 分钟自动拒绝定时器，否则提问无超时（一直等待）。
 */
export function createRuntimeHooks(
  pendingAsks: PendingPermissionRegistry,
  notifyTurnEvent?: TurnEventNotify,
  questionAutoContinue?: () => boolean,
): RuntimeHooks {
  return {
    onDelta: (sessionId, messageId, delta) => {
      // Automation-injected loop turns report their reply text through the
      // observer; every other message id is a no-op there.
      appendObservedReplyDelta(messageId, delta);
      sessions.updateMessage(sessionId, messageId, (m) => {
        m.parts = appendText(m.parts, delta);
      });
      send(IPC.chatDelta, { sessionId, messageId, delta });
    },
    // Structured tool events: persist the part on the assistant message and
    // broadcast it so the renderer mirrors the live stream part-by-part.
    onTool: (sessionId, messageId, part) => {
      // LiveToolPart carries the session spine's optional isError; the shared
      // contract requires it, so normalize at this boundary.
      const normalized: ChatToolEvent["part"] =
        part.type === "toolCall"
          ? part
          : {
              type: "toolResult",
              toolCallId: part.toolCallId,
              content: part.content,
              isError: part.isError === true,
              durationMs: part.durationMs,
              invocationId: part.invocationId,
            };
      sessions.updateMessage(sessionId, messageId, (m) => {
        m.parts.push(normalized);
      });
      send(IPC.chatTool, { sessionId, messageId, part: normalized });
    },
    onThinking: (sessionId, messageId, delta) => {
      sessions.updateMessage(sessionId, messageId, (m) => {
        const last = m.parts[m.parts.length - 1];
        if (last?.type === "thinking") last.text += delta;
        else m.parts.push({ type: "thinking", text: delta });
      });
      send(IPC.chatThinking, { sessionId, messageId, delta });
    },
    onCompleted: (sessionId, messageId, completion) => {
      const mirrored: ChatCompletionMetadata = {
        ...(completion.providerId ? { providerId: completion.providerId } : {}),
        ...(completion.modelId ? { modelId: completion.modelId } : {}),
        ...(completion.usage ? { usage: completion.usage } : {}),
        finishReason: completion.finishReason,
        aborted: completion.aborted,
        ...(completion.responseId ? { responseId: completion.responseId } : {}),
      };
      sessions.updateMessage(sessionId, messageId, (m) => {
        m.streaming = false;
        m.completion = mirrored;
      });
      send(IPC.chatDone, { sessionId, messageId, completion: mirrored });
      notifyTurnEvent?.("completed", sessionId, { aborted: mirrored.aborted });
    },
    // 主路由上下文计量：镜像进会话存储（查询面回放）并广播渲染层。runtime
    // 在钩子前已富化（会话级 cache 累计 + contextWindow）——contextWindow
    // 是富化后的运行时属性（包类型面未声明），按富化形状收窄后展开。
    onContextUsage: (sessionId, raw) => {
      const snapshot = raw as ContextUsageSnapshot & { contextWindow?: number };
      const metered: ChatContextUsageSnapshot = {
        ...snapshot,
        breakdown: { ...snapshot.breakdown },
        cache: { ...snapshot.cache },
        ...(snapshot.contextWindow !== undefined ? { contextWindow: snapshot.contextWindow } : {}),
      };
      sessions.updateContextUsage(sessionId, metered);
      send(IPC.chatContextUsage, { sessionId, snapshot: metered } satisfies ChatContextUsageEvent);
    },
    onError: (sessionId, messageId, error) => {
      // Automation-injected loop turns record the error so an errored turn is
      // judged unproductive even when the runtime mirrored warning text into
      // the collected reply; every other message id is a no-op there.
      markObservedReplyError(messageId, error);
      sessions.updateMessage(sessionId, messageId, (m) => {
        m.streaming = false;
      });
      send(IPC.chatError, { sessionId, messageId, error });
      notifyTurnEvent?.("failed", sessionId);
      logger.warn("harness error", { sessionId, messageId, error });
    },
    askPermission: async (sessionId, messageId, ask) => {
      const event: ChatPermissionEvent = {
        sessionId,
        messageId,
        requestId: ask.requestId,
        toolName: ask.call.toolName,
        args: ask.call.args,
        // 资源与完整调用参数都直接透传到询问界面。
        resource: {
          kind: ask.call.resource.kind,
          action: ask.call.resource.action,
          scope: ask.call.resource.scope,
        },
      };
      return new Promise<PermissionChoice>((resolve) => {
        let settled = false;
        const finish = (choice: PermissionChoice) => {
          if (settled) return;
          settled = true;
          pendingAsks.delete(ask.requestId);
          if (timer !== undefined) clearTimeout(timer);
          resolve(choice);
        };
        // questionAutoContinue 开启：5 分钟未答自动按拒绝落定——循环带着
        // 拒绝结果继续前进（"deny" 失败关闭）。关闭：不设任何定时器，
        // 提问一直等待用户回答。取值以提问发起时的设置快照为准。
        const timer = questionAutoContinue?.() === true
          ? setTimeout(() => finish("deny"), QUESTION_AUTO_CONTINUE_TIMEOUT_MS)
          : undefined;
        pendingAsks.set(ask.requestId, { sessionId, finish });
        send(IPC.chatPermission, event);
        notifyTurnEvent?.("permission", sessionId);
      });
    },
    log: (level, msg, data) => {
      // Route by severity — a runtime dispose failure arrives as "error"
      // and must reach logger.error, not sink into the info stream.
      const entry = { msg, data: String(data) };
      if (level === "error") logger.error("harness", entry);
      else if (level === "warn") logger.warn("harness", entry);
      else logger.info("harness", entry);
    },
  };
}
