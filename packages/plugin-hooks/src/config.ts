// Declarative session hook configuration (batch 4C task 1): parses the
// user/project "hooks:" array into validated definitions. Entries with an
// unknown event, a blank command, or wrong field types are skipped with a
// warning so one bad line never disables the whole hook set; duplicate
// commands are intentionally preserved (the same command may legally serve
// multiple events). Commands are plain whitespace-separated tokens —
// quoting forms are not supported because the runner hands the token
// array straight to the process layer with no shell in between.
// Windows constraint (tracked obligation from the batch review): the runner
// spawns via execFile WITHOUT a shell, so .cmd/.bat scripts and bare "npm"
// invocations cannot be resolved that way (EINVAL/ENOENT) — hook commands
// must name a real executable (for example the node binary) and carry the
// script arguments explicitly.

export const HOOK_EVENTS = [
  "userPromptSubmit",
  "preToolCall",
  "postToolCall",
  "sessionStart",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookDefinition {
  /** Session moment that triggers this hook. */
  event: HookEvent;
  /** Executable plus arguments, split on whitespace (no quoting forms). */
  command: string;
  /** Tool name (tool events) or input prefix (input events); optional. */
  match?: string;
  /** Kill ceiling in milliseconds; upper-clamped, defaults at run time. */
  timeoutMs?: number;
}

export interface ParsedHooks {
  hooks: readonly HookDefinition[];
  warnings: string[];
}

/** Default kill ceiling for a hook command when timeoutMs is absent. */
export const DEFAULT_HOOK_TIMEOUT_MS = 10_000;
/** Hard upper bound for the per-hook kill ceiling. */
export const MAX_HOOK_TIMEOUT_MS = 30_000;

function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === "string" && (HOOK_EVENTS as readonly string[]).includes(value);
}

/** Parses raw configuration into hook definitions plus skip warnings. */
export function parseHookDefinitions(raw: unknown): ParsedHooks {
  if (raw === undefined || raw === null) return { hooks: [], warnings: [] };
  if (!Array.isArray(raw)) {
    return { hooks: [], warnings: [`hooks config must be an array, got ${typeof raw}`] };
  }
  const hooks: HookDefinition[] = [];
  const warnings: string[] = [];
  raw.forEach((entry, index) => {
    const where = `hooks[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      warnings.push(`${where}: entry must be an object`);
      return;
    }
    const record = entry as Record<string, unknown>;

    const event = record.event;
    if (!isHookEvent(event)) {
      warnings.push(`${where}: unknown event ${JSON.stringify(event ?? null)}`);
      return;
    }

    const command = record.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      warnings.push(`${where}: command must be a non-empty string`);
      return;
    }

    const match = record.match;
    if (match !== undefined && (typeof match !== "string" || match.trim().length === 0)) {
      warnings.push(`${where}: match must be a non-empty string when present`);
      return;
    }

    let timeoutMs: number | undefined;
    const rawTimeout = record.timeoutMs;
    if (rawTimeout !== undefined) {
      if (
        typeof rawTimeout !== "number" ||
        !Number.isFinite(rawTimeout) ||
        rawTimeout <= 0
      ) {
        warnings.push(`${where}: timeoutMs must be a positive finite number`);
        return;
      }
      if (rawTimeout > MAX_HOOK_TIMEOUT_MS) {
        warnings.push(
          `${where}: timeoutMs ${rawTimeout} exceeds the ceiling and was clamped to ${MAX_HOOK_TIMEOUT_MS}`,
        );
        timeoutMs = MAX_HOOK_TIMEOUT_MS;
      } else {
        timeoutMs = rawTimeout;
      }
    }

    hooks.push({
      event,
      command: command.trim(),
      ...(match !== undefined ? { match: match.trim() } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  });
  return { hooks, warnings };
}
