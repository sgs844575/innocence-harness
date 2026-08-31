import type { Provider } from "@innocenceharness/harness-providers";
import type { Message } from "@innocenceharness/harness-session";
import type { HookRunInput } from "./runner";

export interface HookConditionEvaluator {
  evaluate(input: { condition: string; hook: HookRunInput }): Promise<{ ok: boolean; reason?: string }>;
}

/** Earlier history is omitted after this many messages; source A:100 requires an explicit insufficiency outcome. */
export const HOOK_EVALUATOR_HISTORY_LIMIT = 20;

/**
 * Provider-backed conditional hook evaluator. It sees only the recent tail;
 * malformed/model/provider responses fail closed (ok:false), so a condition
 * can never unexpectedly run a command. This is intentionally separate from
 * the S3 permission classifier: it evaluates hook applicability, not access.
 */
export function createHookConditionEvaluator(
  provider: Provider,
  getHistory: () => readonly Message[],
): HookConditionEvaluator {
  return {
    async evaluate({ condition, hook }) {
      const full = getHistory();
      const recent = full.slice(-HOOK_EVALUATOR_HISTORY_LIMIT);
      const omitted = full.length - recent.length;
      const system = [
        "You evaluate whether a declarative hook command should run.",
        `Earlier conversation was truncated: ${omitted} message(s) omitted.`,
        "Use only the recent transcript and hook input below. When the missing earlier portion could contain required facts, answer ok:false with reason 'insufficient evidence in transcript'.",
        "Reply with JSON only: {\"ok\":boolean,\"reason\":string}.",
      ].join("\n");
      const text = JSON.stringify({ condition, hook, recent });
      try {
        let out = "";
        for await (const delta of provider.chat({ system, messages: [{ role: "user", parts: [{ type: "text", text }] }], tools: [] })) {
          if (delta.type === "text") out += delta.text;
        }
        const value = JSON.parse(out) as { ok?: unknown; reason?: unknown };
        if (typeof value.ok !== "boolean") return { ok: false, reason: "invalid evaluator response" };
        return { ok: value.ok, ...(typeof value.reason === "string" ? { reason: value.reason } : {}) };
      } catch {
        return { ok: false, reason: "condition evaluator unavailable" };
      }
    },
  };
}
