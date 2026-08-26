import {
  AutomationCandidateSchema,
  type AutomationCandidate,
  type AutomationCandidateService,
} from "@innocenceharness/harness-ai-runtime";
import type { ProviderModel } from "@innocenceharness/harness-providers";

export type { AutomationCandidate } from "@innocenceharness/harness-ai-runtime";

export interface AutomationDefinition {
  id: string;
  name: string;
  candidate: AutomationCandidate;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationStore {
  list(): AutomationDefinition[];
  save(definition: AutomationDefinition): void;
}

export interface AutomationDispatchRequest {
  automationId: string;
  candidate: AutomationCandidate;
  trigger: "manual" | "schedule" | "idle";
  sessionId: string;
  taskId?: string;
  routeId: string;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface AutomationDispatchPort {
  dispatch(request: AutomationDispatchRequest): Promise<void>;
}

export interface AutomationServiceOptions {
  candidateService: AutomationCandidateService;
  candidateModel: ProviderModel | (() => Promise<ProviderModel>);
  store: AutomationStore;
  dispatch: AutomationDispatchPort;
  timeoutMs?: number;
  id?: () => string;
  now?: () => number;
}

export interface AutomationService {
  generateCandidate(prompt: string): Promise<AutomationCandidate>;
  confirmCandidate(candidate: unknown, name: string): Promise<AutomationDefinition>;
  list(): AutomationDefinition[];
  trigger(id: string, input: { trigger: "manual" | "schedule" | "idle"; sessionId: string; taskId?: string; routeId: string }): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createAutomationService(options: AutomationServiceOptions): AutomationService {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const nextId = options.id ?? (() => `automation_${Date.now().toString(36)}`);

  return {
    async generateCandidate(prompt) {
      const normalized = prompt.trim();
      if (!normalized) throw new Error("automation prompt is required");
      const candidateModel = typeof options.candidateModel === "function"
        ? await options.candidateModel()
        : options.candidateModel;
      const result = await options.candidateService.generate({
        model: candidateModel,
        messages: [{ role: "user", parts: [{ type: "text", text: normalized }] }],
      });
      return AutomationCandidateSchema.parse(result.candidate);
    },

    async confirmCandidate(rawCandidate, rawName) {
      const name = rawName.trim();
      if (!name) throw new Error("automation name is required");
      let candidate: AutomationCandidate;
      try {
        candidate = AutomationCandidateSchema.parse(rawCandidate);
      } catch {
        throw new Error("invalid automation candidate");
      }
      const timestamp = now();
      const definition: AutomationDefinition = {
        id: nextId(),
        name,
        candidate,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      options.store.save(definition);
      return definition;
    },

    list() {
      return options.store.list().filter((definition) => {
        try {
          AutomationCandidateSchema.parse(definition.candidate);
          return definition.id.length > 0 && definition.name.trim().length > 0;
        } catch {
          return false;
        }
      });
    },

    async trigger(id, input) {
      if (!input.sessionId) throw new Error("automation session is required");
      const definition = options.store.list().find((item) => item.id === id);
      if (!definition) throw new Error("automation not found");
      let candidate: AutomationCandidate;
      try {
        candidate = AutomationCandidateSchema.parse(definition.candidate);
      } catch {
        throw new Error("invalid automation candidate");
      }
      if (!definition.enabled) throw new Error("automation is disabled");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await options.dispatch.dispatch({
          automationId: definition.id,
          candidate,
          trigger: input.trigger,
          sessionId: input.sessionId,
          ...(input.taskId ? { taskId: input.taskId } : {}),
          routeId: input.routeId,
          signal: controller.signal,
          timeoutMs,
        });
      } finally {
        clearTimeout(timer);
        if (!controller.signal.aborted) controller.abort();
      }
    },
  };
}
