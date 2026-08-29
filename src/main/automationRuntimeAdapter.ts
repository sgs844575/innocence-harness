import type {
  AutomationDispatchPort,
  AutomationDispatchRequest,
  DispatchOutcome,
} from "@innocenceharness/harness-automation";
import { beginObservedReply, endObservedReply } from "./automationReplyObserver";

export interface AutomationRuntimePort {
  send(input: {
    sessionId: string;
    taskId: string;
    routeId: string;
    text: string;
    messageId: string;
  }): Promise<void>;
  stop(sessionId: string, routeId: string): void;
}

/** 自动化触达外部的最小通知面（由通知通道包提供实现）。 */
export interface AutomationNotifySink {
  send(message: { title: string; text: string }): Promise<void>;
}

/** 循环回合的宿主依赖面：loop 载荷解析与全完成后的停用动作。 */
export interface AutomationLoopDispatchOptions {
  /** 解析定义的 loop 载荷与展示名；查不到或载荷无效时回退既有非 loop 回合。 */
  definitionFor(automationId: string): { name: string; loopFile: string } | undefined;
  /** 检测到终止标记后停用定义（接宿主 lifecycle.update，同步停掉步频定时器）。 */
  disable(automationId: string): Promise<void>;
  /** 停用失败的可观测面；停用失败不影响本回合的产出信号。 */
  onDisableError?(error: unknown): void;
}

export interface AutomationRuntimeDispatchOptions {
  runtime: AutomationRuntimePort;
  sessionExists(sessionId: string): boolean;
  taskRouteFor(sessionId: string): { taskId: string; routeId: string } | undefined;
  /** 候选里的 notify 动作经此投递；缺省不通知。 */
  notify?: AutomationNotifySink;
  /** 通知失败的可观测面；通知失败从不致命。 */
  onNotifyError?(error: unknown): void;
  /** 提供后启用循环回合信封、产出信号与全完成自动停用。 */
  loop?: AutomationLoopDispatchOptions;
}

/** 终止标记：清单全部完成时 agent 回复的唯一一行。 */
const LOOP_COMPLETE_MARKER = "[loop-complete]";

/**
 * 循环回合英文信封（LLM 面，英文书写）：首段交代本轮由自动化循环触发、
 * 非用户输入、不带新授权；指令体覆盖清单推进四语义——处理下一未勾项并在
 * 文件内打勾、文件缺席先建骨架再说明本轮跳过、受阻时说明并继续可继续项、
 * 只推进清单既有条目；末段约定全部完成时仅回复终止标记行。
 */
export function buildAutomationLoopTurn(name: string, loopFile: string): string {
  return [
    `This turn was started by the automation loop "${name}", not by the human user. Treat it as machine-triggered work: it brings no new user request and grants no approval beyond what the checklist file already records.`,
    "",
    `Do one pass over the checklist file ${loopFile} (relative to the workspace root of this session):`,
    "- Read the file and take the first entry that is not yet ticked; carry out the work that entry describes, then edit the file so the entry is marked done.",
    "- If the file does not exist yet, create a minimal skeleton first - a title line plus a one-line note that open work items are tracked as a checkbox list in this file - then reply that this pass was skipped and stop.",
    "- If an entry is blocked or the file looks wrong, describe the problem briefly and continue with the next entry that is still actionable.",
    "- Stay on entries the checklist already contains; do not start unrelated new work.",
    "",
    `When every entry is ticked off, reply with exactly one line, ${LOOP_COMPLETE_MARKER}, and nothing else. On any other pass, reply with a short note of what changed.`,
  ].join("\n");
}

interface TurnTarget {
  taskId: string;
  routeId: string;
  text: string;
  messageId: string;
}

/** 发送一个回合：中止信号挂到宿主 stop，与既有通道完全一致。 */
async function sendTurn(
  options: AutomationRuntimeDispatchOptions,
  request: AutomationDispatchRequest,
  target: TurnTarget,
): Promise<void> {
  const stop = () => options.runtime.stop(request.sessionId, target.routeId);
  request.signal.addEventListener("abort", stop, { once: true });
  try {
    await options.runtime.send({
      sessionId: request.sessionId,
      taskId: target.taskId,
      routeId: target.routeId,
      text: target.text,
      messageId: target.messageId,
    });
  } finally {
    request.signal.removeEventListener("abort", stop);
  }
}

/** notify 动作逐条即发即忘，单条失败只留观测面。 */
function deliverNotifications(
  options: AutomationRuntimeDispatchOptions,
  request: AutomationDispatchRequest,
  title: string,
): void {
  const commands = request.candidate.actions
    .filter((action) => action.kind === "notify")
    .map((action) => action.command);
  if (!options.notify || commands.length === 0) return;
  for (const command of commands) {
    options.notify.send({ title, text: command }).catch((error: unknown) => options.onNotifyError?.(error));
  }
}

/** 循环回合：信封注入 + 依据回复文本产出 DispatchOutcome + 全完成停用联动。 */
async function dispatchLoopTurn(
  options: AutomationRuntimeDispatchOptions,
  loop: AutomationLoopDispatchOptions,
  request: AutomationDispatchRequest,
  target: TurnTarget,
): Promise<DispatchOutcome> {
  beginObservedReply(target.messageId);
  let replyText = "";
  try {
    await sendTurn(options, request, target);
    replyText = endObservedReply(target.messageId);
  } catch {
    endObservedReply(target.messageId);
    return { productive: false };
  }
  if (!replyText.includes(LOOP_COMPLETE_MARKER)) {
    return { productive: replyText.trim().length > 0 };
  }
  try {
    await loop.disable(request.automationId);
  } catch (error) {
    loop.onDisableError?.(error);
  }
  deliverNotifications(options, request, `自动化 ${request.automationId} 已完成`);
  return { productive: true };
}

export function createAutomationRuntimeDispatch(options: AutomationRuntimeDispatchOptions): AutomationDispatchPort {
  return {
    async dispatch(request: AutomationDispatchRequest): Promise<DispatchOutcome | void> {
      if (!options.sessionExists(request.sessionId)) throw new Error("automation session not found");
      const binding = options.taskRouteFor(request.sessionId);
      const routeId = binding?.routeId ?? "main";
      const messageId = `automation_${request.automationId}_${Date.now().toString(36)}`;
      const loop = options.loop;
      const loopTarget = loop?.definitionFor(request.automationId);
      if (loop && loopTarget) {
        return dispatchLoopTurn(options, loop, request, {
          taskId: binding?.taskId ?? "",
          routeId,
          text: buildAutomationLoopTurn(loopTarget.name, loopTarget.loopFile),
          messageId,
        });
      }
      const actions = request.candidate.actions.map((action) => `${action.kind}: ${action.command}`).join("\n");
      await sendTurn(options, request, { taskId: binding?.taskId ?? "", routeId, text: `受控自动化：${actions}`, messageId });
      // notify 动作在回合发出后投递；既有非 loop 回合行为保持不变。
      deliverNotifications(options, request, `自动化 ${request.automationId} 已触发`);
    },
  };
}
