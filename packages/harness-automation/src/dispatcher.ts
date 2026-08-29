import type { AutomationDefinition, AutomationLoopPayload, DispatchOutcome } from "./index";

export interface AutomaticAutomationTriggerInput {
  trigger: "schedule" | "idle";
  sessionId: string;
  routeId: string;
  signal: AbortSignal;
}

export interface AutomationDispatcherOptions {
  list(): readonly AutomationDefinition[];
  trigger(id: string, input: AutomaticAutomationTriggerInput): Promise<DispatchOutcome | void>;
  isIdle(minimumIdleMs: number): boolean;
  setTimer?(callback: () => void, delayMs: number): unknown;
  clearTimer?(timer: unknown): void;
  onActivity?(listener: () => void): () => void;
  log?(message: string, data: { id: string; trigger: "schedule" | "idle"; error: "dispatch rejected" }): void;
}

export interface AutomationDispatcher {
  start(): void;
  sync(definitions: readonly AutomationDefinition[]): void;
  remove(id: string): void;
  dispose(): Promise<void>;
}

type AutomaticDefinition = AutomationDefinition & {
  targetSessionId: string;
  candidate: AutomationDefinition["candidate"] & {
    trigger:
      | { kind: "schedule"; expression: string; everyMs: number }
      | { kind: "idle"; expression: string; idleForMs: number };
  };
};

interface ActiveDispatch {
  controller: AbortController;
  settled: Promise<void>;
}

interface Registration {
  definition: AutomaticDefinition;
  fingerprint: string;
  timer?: unknown;
  /** Dynamic pacing state; unset until the first outcome adjusts the interval. */
  intervalMs?: number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

const DEFAULT_MIN_LOOP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_LOOP_INTERVAL_MS = 1_800_000;
const PRODUCTIVE_INTERVAL_FACTOR = 0.8;
const UNPRODUCTIVE_INTERVAL_FACTOR = 1.5;

function validLoopPayload(loop: unknown): loop is AutomationLoopPayload {
  if (!loop || typeof loop !== "object") return false;
  const loopFile = (loop as { loopFile?: unknown }).loopFile;
  return typeof loopFile === "string" && loopFile.trim().length > 0;
}

/** Normalized pacing window for loop definitions that opt into dynamic pacing. */
function loopPacing(definition: AutomationDefinition): { minMs: number; maxMs: number } | undefined {
  if (!validLoopPayload(definition.loop)) return undefined;
  const pacing = definition.loop.pacing;
  if (!pacing || typeof pacing !== "object") return undefined;
  const rawMin = (pacing as { minMs?: unknown }).minMs;
  const rawMax = (pacing as { maxMs?: unknown }).maxMs;
  const minMs = isPositiveInteger(rawMin) ? rawMin : DEFAULT_MIN_LOOP_INTERVAL_MS;
  const maxMs = isPositiveInteger(rawMax) ? rawMax : DEFAULT_MAX_LOOP_INTERVAL_MS;
  return minMs <= maxMs ? { minMs, maxMs } : { minMs: maxMs, maxMs: minMs };
}

function configuredIntervalMs(definition: AutomaticDefinition): number {
  const trigger = definition.candidate.trigger;
  return trigger.kind === "schedule" ? trigger.everyMs : trigger.idleForMs;
}

function automaticDefinition(definition: AutomationDefinition): AutomaticDefinition | undefined {
  if (!definition.enabled || typeof definition.targetSessionId !== "string" || !definition.targetSessionId.trim()) return undefined;
  const trigger = definition.candidate?.trigger;
  if (!trigger || typeof trigger !== "object") return undefined;
  if (trigger.kind === "schedule" && isPositiveInteger((trigger as { everyMs?: unknown }).everyMs)) {
    return definition as AutomaticDefinition;
  }
  if (trigger.kind === "idle" && isPositiveInteger((trigger as { idleForMs?: unknown }).idleForMs)) {
    return definition as AutomaticDefinition;
  }
  return undefined;
}

function loopFingerprintPart(definition: AutomationDefinition): string {
  if (!validLoopPayload(definition.loop)) return "";
  const loopFile = definition.loop.loopFile.trim();
  const pacing = loopPacing(definition);
  return pacing ? `:loop:${loopFile}:${pacing.minMs}:${pacing.maxMs}` : `:loop:${loopFile}`;
}

function fingerprint(definition: AutomaticDefinition): string {
  const trigger = definition.candidate.trigger;
  const base = trigger.kind === "schedule"
    ? `${definition.updatedAt}:schedule:${definition.targetSessionId}:${trigger.everyMs}`
    : `${definition.updatedAt}:idle:${definition.targetSessionId}:${trigger.idleForMs}`;
  return base + loopFingerprintPart(definition);
}

export function createAutomationDispatcher(options: AutomationDispatcherOptions): AutomationDispatcher {
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const registrations = new Map<string, Registration>();
  const active = new Map<string, ActiveDispatch>();
  let disposed = false;
  let unsubscribeActivity: (() => void) | undefined;

  const clearRegistrationTimer = (registration: Registration): void => {
    if (registration.timer !== undefined) {
      clearTimer(registration.timer);
      registration.timer = undefined;
    }
  };

  const schedule = (registration: Registration): void => {
    if (disposed || active.has(registration.definition.id)) return;
    clearRegistrationTimer(registration);
    const trigger = registration.definition.candidate.trigger;
    const delayMs = registration.intervalMs ?? configuredIntervalMs(registration.definition);
    registration.timer = setTimer(() => {
      registration.timer = undefined;
      if (trigger.kind === "idle" && !options.isIdle(trigger.idleForMs)) {
        schedule(registration);
        return;
      }
      void dispatch(registration);
    }, delayMs);
  };

  /** Adjusts the dynamic pacing interval from one dispatch outcome; no-op without loop pacing. */
  const applyPacing = (registration: Registration, outcome: DispatchOutcome | void): void => {
    const pacing = loopPacing(registration.definition);
    if (!pacing || !outcome) return;
    const currentMs = registration.intervalMs ?? configuredIntervalMs(registration.definition);
    const scaled = outcome.productive !== false
      ? currentMs * PRODUCTIVE_INTERVAL_FACTOR
      : currentMs * UNPRODUCTIVE_INTERVAL_FACTOR;
    registration.intervalMs = Math.round(Math.min(Math.max(scaled, pacing.minMs), pacing.maxMs));
  };

  const dispatch = async (registration: Registration): Promise<void> => {
    const { definition } = registration;
    if (disposed || registrations.get(definition.id) !== registration || active.has(definition.id)) return;
    const trigger = definition.candidate.trigger.kind;
    const controller = new AbortController();
    let resolveSettled: (() => void) | undefined;
    const activeDispatch: ActiveDispatch = {
      controller,
      settled: new Promise<void>((resolve) => { resolveSettled = resolve; }),
    };
    active.set(definition.id, activeDispatch);
    let outcome: DispatchOutcome | void = undefined;
    try {
      outcome = await options.trigger(definition.id, {
        trigger,
        sessionId: definition.targetSessionId,
        routeId: "main",
        signal: controller.signal,
      });
    } catch {
      options.log?.("automation dispatch failed", { id: definition.id, trigger, error: "dispatch rejected" });
    } finally {
      if (!controller.signal.aborted) controller.abort();
      if (active.get(definition.id) === activeDispatch) active.delete(definition.id);
      resolveSettled?.();
      const current = registrations.get(definition.id);
      if (!disposed && current) {
        // Only the dispatch's own registration may consume its outcome; a rebuilt one restarts from the configured interval.
        if (current === registration) applyPacing(current, outcome);
        schedule(current);
      }
    }
  };

  const remove = (id: string): void => {
    const registration = registrations.get(id);
    if (registration) {
      clearRegistrationTimer(registration);
      registrations.delete(id);
    }
    active.get(id)?.controller.abort();
  };

  return {
    start(): void {
      if (disposed || unsubscribeActivity) return;
      unsubscribeActivity = options.onActivity?.(() => {
        for (const registration of registrations.values()) {
          if (registration.definition.candidate.trigger.kind === "idle") schedule(registration);
        }
      }) ?? (() => undefined);
      this.sync(options.list());
    },

    sync(definitions): void {
      if (disposed) return;
      const next = new Map<string, AutomaticDefinition>();
      for (const definition of definitions) {
        const automatic = automaticDefinition(definition);
        if (automatic) next.set(automatic.id, automatic);
      }
      for (const [id, registration] of registrations) {
        const replacement = next.get(id);
        if (!replacement || fingerprint(replacement) !== registration.fingerprint) remove(id);
      }
      for (const definition of next.values()) {
        if (registrations.has(definition.id)) continue;
        const registration: Registration = { definition, fingerprint: fingerprint(definition) };
        registrations.set(definition.id, registration);
        schedule(registration);
      }
    },

    remove,

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      unsubscribeActivity?.();
      unsubscribeActivity = undefined;
      for (const registration of registrations.values()) clearRegistrationTimer(registration);
      registrations.clear();
      const activeDispatches = [...active.values()];
      for (const activeDispatch of activeDispatches) activeDispatch.controller.abort();
      await Promise.all(activeDispatches.map((activeDispatch) => activeDispatch.settled));
      active.clear();
    },
  };
}
