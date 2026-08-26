import {
  createAutomationDispatcher,
  type AutomationCandidate,
  type AutomationDefinition,
  type AutomationDispatcher,
  type AutomationService,
} from "@innocenceharness/harness-automation";

export interface AutomationLifecycleOptions {
  controlledService: AutomationService;
  isIdle(minimumIdleMs: number): boolean;
  onActivity?(listener: () => void): () => void;
  log?(message: string, data: { id: string; trigger: "schedule" | "idle"; error: "dispatch rejected" }): void;
  dispatcher?: AutomationDispatcher;
}

export interface AutomationLifecycle {
  start(): void;
  confirm(candidate: AutomationCandidate, name: string, targetSessionId?: string): Promise<AutomationDefinition>;
  update(id: string, candidate: AutomationCandidate, name: string, targetSessionId: string | undefined, enabled: boolean): Promise<AutomationDefinition>;
  delete(id: string): boolean;
  dispose(): Promise<void>;
}

export function createAutomationLifecycle(options: AutomationLifecycleOptions): AutomationLifecycle {
  const dispatcher = options.dispatcher ?? createAutomationDispatcher({
    list: () => options.controlledService.list(),
    trigger: (id, input) => options.controlledService.trigger(id, input),
    isIdle: options.isIdle,
    ...(options.onActivity ? { onActivity: options.onActivity } : {}),
    ...(options.log ? { log: options.log } : {}),
  });

  const sync = (): void => dispatcher.sync(options.controlledService.list());

  return {
    start(): void {
      dispatcher.start();
    },

    async confirm(candidate, name, targetSessionId) {
      const definition = await options.controlledService.confirmCandidate(candidate, name, targetSessionId);
      sync();
      return definition;
    },

    async update(id, candidate, name, targetSessionId, enabled) {
      const definition = await options.controlledService.updateDefinition(id, candidate, name, targetSessionId, enabled);
      sync();
      return definition;
    },

    delete(id): boolean {
      const removed = options.controlledService.deleteDefinition(id);
      if (removed) dispatcher.remove(id);
      return removed;
    },

    dispose: () => dispatcher.dispose(),
  };
}
