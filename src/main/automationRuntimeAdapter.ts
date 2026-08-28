import type { AutomationDispatchPort, AutomationDispatchRequest } from "@innocenceharness/harness-automation";

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

export interface AutomationRuntimeDispatchOptions {
  runtime: AutomationRuntimePort;
  sessionExists(sessionId: string): boolean;
  taskRouteFor(sessionId: string): { taskId: string; routeId: string } | undefined;
  /** 候选里的 notify 动作经此投递；缺省不通知。 */
  notify?: AutomationNotifySink;
  /** 通知失败的可观测面；通知失败从不致命。 */
  onNotifyError?(error: unknown): void;
}

export function createAutomationRuntimeDispatch(options: AutomationRuntimeDispatchOptions): AutomationDispatchPort {
  return {
    async dispatch(request: AutomationDispatchRequest): Promise<void> {
      if (!options.sessionExists(request.sessionId)) throw new Error("automation session not found");
      const binding = options.taskRouteFor(request.sessionId);
      const routeId = binding?.routeId ?? "main";
      const text = request.candidate.actions.map((action) => `${action.kind}: ${action.command}`).join("\n");
      const stop = () => options.runtime.stop(request.sessionId, routeId);
      request.signal.addEventListener("abort", stop, { once: true });
      try {
        await options.runtime.send({
          sessionId: request.sessionId,
          taskId: binding?.taskId ?? "",
          routeId,
          text: `受控自动化：${text}`,
          messageId: `automation_${request.automationId}_${Date.now().toString(36)}`,
        });
      } finally {
        request.signal.removeEventListener("abort", stop);
      }
      // notify 动作在回合发出后投递；逐条即发即忘，单条失败只留观测面。
      const notifications = request.candidate.actions
        .filter((action) => action.kind === "notify")
        .map((action) => action.command);
      if (options.notify && notifications.length > 0) {
        const title = `自动化 ${request.automationId} 已触发`;
        for (const command of notifications) {
          options.notify.send({ title, text: command }).catch((error: unknown) => options.onNotifyError?.(error));
        }
      }
    },
  };
}
