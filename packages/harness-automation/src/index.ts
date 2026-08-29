import {
  AutomationCandidateSchema,
  type AutomationCandidate,
  type AutomationCandidateService,
} from "@innocenceharness/harness-ai-runtime";
import type { ProviderModel } from "@innocenceharness/harness-providers";

export { createAutomationDispatcher } from "./dispatcher";
export type {
  AutomationDispatcher,
  AutomationDispatcherOptions,
  AutomaticAutomationTriggerInput,
} from "./dispatcher";

export type { AutomationCandidate } from "@innocenceharness/harness-ai-runtime";

/** Pacing window for loop definitions; omitted bounds fall back to dispatcher defaults. */
export interface AutomationLoopPacing {
  minMs?: number;
  maxMs?: number;
}

/** Optional loop payload: a checklist-driven turn dispatched on the schedule cadence. */
export interface AutomationLoopPayload {
  loopFile: string;
  pacing?: AutomationLoopPacing;
}

/** Result of one controlled dispatch; `productive: false` signals an idle turn. */
export interface DispatchOutcome {
  productive?: boolean;
}

export interface AutomationDefinition {
  id: string;
  name: string;
  candidate: AutomationCandidate;
  /** Host session identity supplied when the definition is confirmed. */
  targetSessionId?: string;
  /** Optional loop payload; absent means plain schedule/idle semantics. */
  loop?: AutomationLoopPayload;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationStore {
  list(): AutomationDefinition[];
  save(definition: AutomationDefinition): void;
  remove(id: string): boolean;
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
  /** Returning a `DispatchOutcome` enables dispatcher dynamic pacing; `void` keeps intervals fixed. */
  dispatch(request: AutomationDispatchRequest): Promise<DispatchOutcome | void>;
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
  confirmCandidate(candidate: unknown, name: string, targetSessionId?: string): Promise<AutomationDefinition>;
  updateDefinition(
    id: string,
    candidate: unknown,
    name: string,
    targetSessionId: string | undefined,
    enabled: boolean,
  ): Promise<AutomationDefinition>;
  deleteDefinition(id: string): boolean;
  list(): AutomationDefinition[];
  trigger(id: string, input: {
    trigger: "manual" | "schedule" | "idle";
    sessionId: string;
    taskId?: string;
    routeId: string;
    signal?: AbortSignal;
  }): Promise<DispatchOutcome | void>;
}

function parseStoredCandidate(raw: unknown): AutomationCandidate | undefined {
  try {
    return AutomationCandidateSchema.parse(raw);
  } catch {
    if (!raw || typeof raw !== "object") return undefined;
    const candidate = raw as Record<string, unknown>;
    const trigger = candidate.trigger;
    const actions = candidate.actions;
    const constraints = candidate.constraints;
    const reviewSummary = candidate.reviewSummary;
    if (!trigger || typeof trigger !== "object" || !Array.isArray(actions) || !Array.isArray(constraints) || typeof reviewSummary !== "string" || !reviewSummary.trim()) return undefined;
    const triggerRecord = trigger as Record<string, unknown>;
    if (!["schedule", "idle", "manual"].includes(String(triggerRecord.kind)) || typeof triggerRecord.expression !== "string" || !triggerRecord.expression.trim()) return undefined;
    if (!actions.every((action) => {
      if (!action || typeof action !== "object") return false;
      const item = action as Record<string, unknown>;
      return ["run-command", "notify", "review"].includes(String(item.kind)) && typeof item.command === "string" && Boolean(item.command.trim());
    })) return undefined;
    if (!constraints.every((constraint) => typeof constraint === "string" && Boolean(constraint.trim()))) return undefined;
    return raw as AutomationCandidate;
  }
}

function requiredText(raw: unknown, error: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(error);
  return raw.trim();
}

function optionalTargetSessionId(raw: unknown): string {
  if (raw === undefined) return "";
  return requiredText(raw, "automation target session is required");
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createAutomationService(options: AutomationServiceOptions): AutomationService {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const nextId = options.id ?? (() => `automation_${Date.now().toString(36)}`);
  const running = new Set<string>();

  return {
    async generateCandidate(prompt) {
      const normalized = requiredText(prompt, "automation prompt is required");
      const candidateModel = typeof options.candidateModel === "function"
        ? await options.candidateModel()
        : options.candidateModel;
      const result = await options.candidateService.generate({
        model: candidateModel,
        messages: [{ role: "user", parts: [{ type: "text", text: normalized }] }],
      });
      return AutomationCandidateSchema.parse(result.candidate);
    },

    async confirmCandidate(rawCandidate, rawName, rawTargetSessionId) {
      const name = requiredText(rawName, "automation name is required");
      const targetSessionId = optionalTargetSessionId(rawTargetSessionId);
      let candidate: AutomationCandidate;
      try {
        candidate = AutomationCandidateSchema.parse(rawCandidate);
      } catch {
        throw new Error("invalid automation candidate");
      }
      if (candidate.trigger.kind !== "manual" && !targetSessionId) {
        throw new Error("automation target session is required");
      }
      const timestamp = now();
      const definition: AutomationDefinition = {
        id: nextId(),
        name,
        candidate,
        ...(targetSessionId ? { targetSessionId } : {}),
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      options.store.save(definition);
      return definition;
    },

    async updateDefinition(rawId, rawCandidate, rawName, rawTargetSessionId, enabled) {
      const id = requiredText(rawId, "automation id is required");
      if (typeof enabled !== "boolean") throw new Error("automation enabled flag is required");
      const current = options.store.list().find((definition) => definition.id === id);
      if (!current) throw new Error("automation not found");
      const name = requiredText(rawName, "automation name is required");
      const targetSessionId = optionalTargetSessionId(rawTargetSessionId);
      let candidate: AutomationCandidate;
      try {
        candidate = AutomationCandidateSchema.parse(rawCandidate);
      } catch {
        throw new Error("invalid automation candidate");
      }
      if (candidate.trigger.kind !== "manual" && !targetSessionId) {
        throw new Error("automation target session is required");
      }
      const definition: AutomationDefinition = {
        id: current.id,
        name,
        candidate,
        ...(targetSessionId ? { targetSessionId } : {}),
        ...(current.loop ? { loop: current.loop } : {}),
        enabled,
        createdAt: current.createdAt,
        updatedAt: now(),
      };
      options.store.save(definition);
      return definition;
    },

    deleteDefinition(rawId) {
      return options.store.remove(requiredText(rawId, "automation id is required"));
    },

    list() {
      return options.store.list().filter((definition) =>
        definition.id.length > 0 && definition.name.trim().length > 0 && parseStoredCandidate(definition.candidate) !== undefined,
      );
    },

    async trigger(rawId, input) {
      const id = requiredText(rawId, "automation id is required");
      if (input.signal?.aborted) return;
      if (typeof input.sessionId !== "string" || !input.sessionId.trim()) throw new Error("automation session is required");
      if (input.trigger !== "manual" && input.trigger !== "schedule" && input.trigger !== "idle") {
        throw new Error("invalid automation trigger");
      }
      if (typeof input.routeId !== "string" || !input.routeId.trim()) throw new Error("automation route is required");
      const definition = options.store.list().find((item) => item.id === id);
      if (!definition) throw new Error("automation not found");
      const candidate = parseStoredCandidate(definition.candidate);
      if (!candidate) throw new Error("invalid automation candidate");
      if (!definition.enabled) throw new Error("automation is disabled");
      if (running.has(id)) throw new Error("automation already running");
      running.add(id);
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) controller.abort();
      const timer = setTimeout(abort, timeoutMs);
      let outcome: DispatchOutcome | void;
      try {
        outcome = await options.dispatch.dispatch({
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
        input.signal?.removeEventListener("abort", abort);
        if (!controller.signal.aborted) controller.abort();
        running.delete(id);
      }
      return outcome;
    },
  };
}
