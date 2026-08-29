// Hook stop face (batch 5): teardown-time execution of sessionStop hooks.
// The plugin's apply returns the disposer built here as its startup result,
// so the kernel fiber registers it and invokes it exactly once while the
// session unwinds — that unwind is the sessionStop execution point. The
// face shares the wiring's parsed-config cache, permission gate and guarded
// runner seam, which is why it is constructed inside createHooksWiring.
//
// Fail-soft is a hard contract: settleSessionKernel aggregates any disposer
// throw into a session dispose failure, so nothing on this path may ever
// reject — a stop hook failure, a timing-out command or a broken config
// read all degrade to log lines, never to a blocked or failed teardown.
//
// Output is NOT injected anywhere (the conversation is over by the time
// this runs); successful commands get one info summary line with a bounded
// flattened excerpt, and failures get one warn line. The wait for the
// batch is bounded by the LARGEST single clamped per-command ceiling plus
// one settlement grace (a deadline kill settles only after its grace
// window): past it the teardown moves on and the still-pending commands
// keep running detached under their own runner deadlines, so session
// release (and app exit) is never delayed beyond one hook's budget no
// matter how many stop commands are declared. A session restart builds a
// new wiring instance, so the same configuration runs its stop hooks again
// for the new session lifetime — the event is once per session instance,
// not once per config.
import type { HookDefinition, ParsedHooks } from "./config";
import type { HookPermissionGate } from "./gate";
import { clampHookTimeoutMs, HOOK_SETTLEMENT_GRACE_MS, type HookRunInput, type HookRunResult } from "./runner";
import {
  formatStopHookFailure,
  formatStopHookSummary,
  formatStopSkippedForShutdown,
  formatStopWaitReleased,
} from "./wording";

/** Severity plus message of one stop-face log line (host log, not model text). */
export type HookLogSink = (level: "info" | "warn", message: string) => void;

/** The wiring-owned pieces the stop face borrows (constructed per wiring). */
export interface StopFaceDependencies {
  /** Shared first-encounter command gate (authorization cache included). */
  readonly gate: HookPermissionGate;
  /** The wiring's cached config reader; degrades to empty plus warnings. */
  readonly loadHooks: () => Promise<ParsedHooks>;
  /** The wiring's guarded runner call (never throws by construction). */
  readonly runGuarded: (hook: HookDefinition, input: HookRunInput) => Promise<HookRunResult>;
  /** Workspace root used as every stop command's cwd. */
  readonly getWorkspaceRoot: () => string;
  /**
   * Log sink for the face's summary and warning lines; the plugin factory
   * wires this to the session's logger service. Without a sink the stop
   * face runs silently.
   */
  readonly log?: HookLogSink;
  /**
   * Quit-path bypass: when the host reports it is shutting down, the stop
   * face is skipped entirely — an exiting process must not spawn fresh
   * hook children during teardown (the host threads its shutdown state
   * through this getter; absence means the session is simply ending).
   */
  readonly isHostShuttingDown?: () => boolean;
}

/** Serially runs the configured sessionStop commands inside a bounded wait. */
async function runStopBatch(deps: StopFaceDependencies, stopHooks: readonly HookDefinition[]): Promise<void> {
  const log = deps.log;
  const cwd = deps.getWorkspaceRoot();
  for (const hook of stopHooks) {
    const skip = await deps.gate.authorize(hook);
    if (skip !== null) {
      log?.("warn", skip);
      continue;
    }
    const result = await deps.runGuarded(hook, { cwd });
    if (result.ok) log?.("info", formatStopHookSummary(hook.command, result.output));
    else log?.("warn", formatStopHookFailure(hook.command, result));
  }
}

/**
 * Builds the sessionStop disposer for one wiring instance: idempotent
 * (the first call arms a one-way flag; repeat calls return immediately
 * without re-awaiting or replaying the first run's outcome) and fail-soft
 * (never rejects, whatever the hooks or the config do).
 */
export function createStopFace(deps: StopFaceDependencies): () => Promise<void> {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    try {
      if (deps.isHostShuttingDown?.()) {
        deps.log?.("info", formatStopSkippedForShutdown());
        return;
      }
      const parsed = await deps.loadHooks();
      const stopHooks = parsed.hooks.filter((hook) => hook.event === "sessionStop");
      if (stopHooks.length === 0) return;
      // The batch's wait ceiling is the largest clamped per-command deadline
      // PLUS one settlement grace: a deadline-killed command settles only
      // after its kill-grace window (runner HOOK_SETTLEMENT_GRACE_MS), so a
      // bare-deadline race would release on commands the runner is about to
      // settle on schedule and misreport them as over-budget stragglers.
      const waitMs =
        stopHooks.reduce(
          (ceiling, hook) => Math.max(ceiling, clampHookTimeoutMs(hook.timeoutMs)),
          0,
        ) + HOOK_SETTLEMENT_GRACE_MS;
      const batch = runStopBatch(deps, stopHooks);
      // The batch resolves by construction (runGuarded never rejects), but
      // a defensive catch keeps a detached late rejection from surfacing as
      // an unhandled one after the race below has released the caller.
      void batch.catch(() => {});
      let released = false;
      let releaseTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          batch,
          new Promise<void>((resolve) => {
            releaseTimer = setTimeout(() => {
              released = true;
              resolve();
            }, waitMs);
          }),
        ]);
      } finally {
        // A pending timer pins the Node event loop (and a quitting process)
        // until it fires, so it is dropped on BOTH race outcomes — a quick
        // batch win must not leave a dangling ceiling behind.
        if (releaseTimer !== undefined) clearTimeout(releaseTimer);
      }
      if (released) deps.log?.("warn", formatStopWaitReleased(waitMs));
    } catch {
      // Fail-soft by contract: no stop-hook outcome may ever surface as a
      // dispose failure (settleSessionKernel aggregates disposer throws).
    }
  };
}
