// Hook command permission gate (final review round, finding 1): no hook
// command executes until its command string has one permission resolution
// — declarative hooks are configuration-borne code execution, and a
// project-layer declaration must not run silently on the first message
// after cloning a third-party repository. The gate consumes the
// permissions spine exactly like the planflow plugin (ctx.permissions read
// at call time, ServiceTable liveness respected) and resolves a synthetic
// resource {action:"run", kind:"hook", scope:<executable name>} through
// the ordinary engine pipeline, so mode rules, session grants and the ask
// stage all apply: a user approving the ask authorizes that command, an
// "allow for this session" answer becomes an engine session grant, and the
// gate itself additionally caches allowed command strings so the same
// command never resolves twice per wiring instance. A denial is NOT
// cached — a denied ask re-asks on the next encounter, matching how a
// denied tool call behaves. User-carried and project-carried declarations
// pass the same gate (one uniform authorization surface).
//
// The authorization surface is fail-CLOSED: when the permissions service
// is absent (host without the spine, or the fiber's absence window) the
// command is skipped with a warning. This is deliberately stricter than
// the executor's fail-open rule — a missing gate is a missing
// authorization, not a broken hook.
import type { PermissionsService } from "@innocenceharness/harness-permissions";
import { redactCommandSummary } from "@innocenceharness/harness-tools";
import type { HookDefinition } from "./config";
import { formatPermissionSkip } from "./wording";

/** Tool name stamped on the gate's permission requests. */
export const HOOKS_PERMISSION_TOOL_NAME = "hooks";

export interface HookGateOptions {
  /**
   * Reads the permissions spine service; undefined while the fiber is
   * absent (fail-closed skip). Mirrors the planflow ctx.permissions read.
   */
  readonly getPermissions?: () => PermissionsService | undefined;
}

export interface HookPermissionGate {
  /**
   * Decides whether one hook may execute. Null when the command is
   * authorized (now or earlier in this wiring instance); otherwise the
   * warning line describing the skip.
   */
  authorize(hook: HookDefinition): Promise<string | null>;
}

/** Canonical command key: whitespace-collapsed full command string. */
export function normalizeHookCommand(command: string): string {
  return command.trim().split(/\s+/).filter((token) => token.length > 0).join(" ");
}

export function createHookPermissionGate(options: HookGateOptions): HookPermissionGate {
  const authorized = new Set<string>();
  return {
    async authorize(hook) {
      const key = normalizeHookCommand(hook.command);
      if (key.length === 0 || authorized.has(key)) return null;
      const service = options.getPermissions?.();
      if (service === undefined) {
        return formatPermissionSkip(
          hook,
          "no permission service is available to authorize hook commands",
        );
      }
      try {
        const resolution = await service.engine.resolve(
          {
            toolName: HOOKS_PERMISSION_TOOL_NAME,
            resource: { action: "run", kind: "hook", scope: key.split(" ")[0] },
            args: { command: redactCommandSummary(key) },
          },
          { readOnly: false, sideEffect: "process" },
        );
        if (resolution.decision === "allow") {
          authorized.add(key);
          return null;
        }
        return formatPermissionSkip(hook, resolution.reason);
      } catch (error) {
        // A hard resource validation rejection is an authorization denial.
        const message = error instanceof Error ? error.message : String(error);
        return formatPermissionSkip(hook, message);
      }
    },
  };
}
