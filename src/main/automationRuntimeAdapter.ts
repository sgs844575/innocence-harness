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

export interface AutomationRuntimeDispatchOptions {
  runtime: AutomationRuntimePort;
  sessionExists(sessionId: string): boolean;
  taskRouteFor(sessionId: string): { taskId: string; routeId: string } | undefined;
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
    },
  };
}
