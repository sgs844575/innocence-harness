// Hook command runner (batch 4C task 1): executes one parsed hook through
// the process layer with a plain argument array — no shell sits between
// the parsed tokens and the executable, so there is no string-concatenation
// injection surface. Combined output is bounded, merged and marked when
// truncated; a timeout kills the child tree following the shell-tool
// precedent (tree kill on win32, direct signal elsewhere), and every kill
// (deadline or abort) is followed by a bounded grace window after which
// the run settles unconditionally — an inherited-pipe grandchild can keep
// the execFile callback pending forever, and no hook may hang the
// pipeline. Hook output is additional context for the model, never a
// user instruction.
import { execFile as nodeExecFile, spawn } from "node:child_process";
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  MAX_HOOK_TIMEOUT_MS,
  type HookDefinition,
} from "./config";

/** Combined stdout+stderr budget for one hook run. */
export const MAX_HOOK_OUTPUT_CHARS = 8192;
/** Budget for the HOOK_INPUT_PREVIEW environment value. */
export const MAX_HOOK_PREVIEW_CHARS = 512;
/**
 * Grace window after a kill (deadline or abort) before the run settles
 * without its callback: the execFile callback fires only once the child
 * exits AND its stdio pipes drain, so a grandchild holding an inherited
 * pipe outlives the kill and would leave the promise pending forever
 * (final-review finding) — past this window the run force-settles.
 */
export const HOOK_SETTLEMENT_GRACE_MS = 500;
const OUTPUT_TRUNCATION_MARKER = "[hook output truncated]";
const PREVIEW_TRUNCATION_MARKER = "[preview truncated]";
const SETTLEMENT_OUTPUT = "hook process was killed but its output streams never closed";
const ABORT_BEFORE_START_OUTPUT = "hook run was aborted before it started";
/** Per-stream capture ceiling for the process layer; the visible budget
 *  above stays authoritative for the merged result. */
const SPAWN_MAX_BUFFER = 64 * 1024;

export interface HookRunInput {
  toolName?: string;
  inputPreview?: string;
  /** Working directory for the command — the session's workspace root. */
  cwd?: string;
  /** Aborts the run: the child tree is killed and the run settles. */
  signal?: AbortSignal;
}

export interface HookRunResult {
  ok: boolean;
  output: string;
  timedOut?: boolean;
  /**
   * Numeric exit status when the command itself exited non-zero — the
   * explicit user-hook refusal signal. Absent for infrastructure failures
   * (timeout kill, spawn error), so wiring can deny only on real exits.
   */
  exitCode?: number;
  /** True when the run was cut short by an abort signal instead of the
   *  deadline; an infrastructure failure for wiring (fail-open). */
  aborted?: boolean;
  /** Condition evaluator decided this hook is inapplicable (not a runner failure). */
  skipped?: boolean;
}

export interface HookExecFileOptions {
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  maxBuffer?: number;
  cwd?: string;
}

export type HookExecFileError = Error & {
  code?: number | string | null;
  killed?: boolean;
  signal?: string;
};

export interface HookChildProcess {
  pid?: number;
  kill(signal?: string): void;
}

/** Injectable process-layer entry, mirroring the model-factory pattern. */
export type HookExecFile = (
  file: string,
  args: readonly string[],
  options: HookExecFileOptions,
  callback: (error: HookExecFileError | null, stdout: string, stderr: string) => void,
) => HookChildProcess;

export interface HookRunnerDependencies {
  execFile?: HookExecFile;
}

export interface HookRunner {
  runHook(hook: HookDefinition, input: HookRunInput): Promise<HookRunResult>;
}

const defaultExecFile: HookExecFile = (file, args, options, callback) => {
  const child = nodeExecFile(file, args, { ...options, encoding: "utf8" }, callback);
  return {
    pid: child.pid,
    kill(signal?: string) {
      child.kill((signal ?? "SIGKILL") as NodeJS.Signals);
    },
  };
};

/** Kills the child tree — a hook command may leave grandchildren that a
 *  plain signal on the direct child would orphan (shell-tool precedent). */
function killTree(child: HookChildProcess): void {
  if (typeof child.pid === "number" && process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGKILL");
  }
}

/** Clamps a configured per-hook ceiling: unset defaults, values are
 *  rounded and bounded to [1, MAX_HOOK_TIMEOUT_MS]. Shared by the run
 *  path and the stop face's teardown-wait budget. */
export function clampHookTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_HOOK_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(timeoutMs), 1), MAX_HOOK_TIMEOUT_MS);
}

function capText(text: string, cap: number, marker: string): string {
  if (text.length <= cap) return text;
  return text.slice(0, cap - marker.length) + marker;
}

function buildEnvironment(hook: HookDefinition, input: HookRunInput): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOOK_EVENT: hook.event,
    HOOK_TOOL: input.toolName ?? "",
    HOOK_INPUT_PREVIEW: capText(input.inputPreview ?? "", MAX_HOOK_PREVIEW_CHARS, PREVIEW_TRUNCATION_MARKER),
  };
}

/** Creates a hook runner; tests inject a fake process-layer entry. */
export function createHookRunner(dependencies: HookRunnerDependencies = {}): HookRunner {
  const execFileImpl = dependencies.execFile ?? defaultExecFile;
  return {
    async runHook(hook, input) {
      const tokens = hook.command.trim().split(/\s+/).filter((token) => token.length > 0);
      if (tokens.length === 0) {
        return { ok: false, output: "hook command is empty" };
      }
      const [file, ...args] = tokens;
      const timeoutMs = clampHookTimeoutMs(hook.timeoutMs);
      if (input.signal?.aborted) {
        return { ok: false, output: ABORT_BEFORE_START_OUTPUT, aborted: true };
      }
      return new Promise<HookRunResult>((resolve) => {
        let timedOut = false;
        let aborted = false;
        let settled = false;
        let forceTimer: ReturnType<typeof setTimeout> | undefined;
        let child: HookChildProcess | undefined;
        const finish = (result: HookRunResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          input.signal?.removeEventListener("abort", onAbort);
          resolve(result);
        };
        // Forced settlement (final-review finding): after a kill the
        // ordinary callback gets one grace window; past it the run settles
        // as a failed timeout/abort instead of hanging the caller.
        const armForceSettle = (): void => {
          if (settled || forceTimer !== undefined) return;
          forceTimer = setTimeout(() => {
            finish({
              ok: false,
              output: capText(SETTLEMENT_OUTPUT, MAX_HOOK_OUTPUT_CHARS, OUTPUT_TRUNCATION_MARKER),
              ...(timedOut ? { timedOut: true } : {}),
              ...(aborted ? { aborted: true } : {}),
            });
          }, HOOK_SETTLEMENT_GRACE_MS);
        };
        const onAbort = (): void => {
          if (settled) return;
          aborted = true;
          if (child !== undefined) killTree(child);
          armForceSettle();
        };
        const timer = setTimeout(() => {
          timedOut = true;
          if (child !== undefined) killTree(child);
          armForceSettle();
        }, timeoutMs);
        try {
          child = execFileImpl(
            file,
            args,
            {
              env: buildEnvironment(hook, input),
              windowsHide: true,
              maxBuffer: SPAWN_MAX_BUFFER,
              ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
            },
            (error, stdout, stderr) => {
              const parts: string[] = [];
              if (stdout) parts.push(stdout);
              if (stderr) parts.push(stderr);
              if (error && !timedOut && !aborted) {
                if (typeof error.code === "number") parts.push(`[exit ${error.code}]`);
                else parts.push(error.message);
              }
              finish({
                ok: error === null && !timedOut && !aborted,
                output: capText(parts.join("\n"), MAX_HOOK_OUTPUT_CHARS, OUTPUT_TRUNCATION_MARKER),
                ...(timedOut ? { timedOut: true } : {}),
                ...(aborted ? { aborted: true } : {}),
                ...(error !== null && !timedOut && !aborted && typeof error.code === "number"
                  ? { exitCode: error.code }
                  : {}),
              });
            },
          );
          input.signal?.addEventListener("abort", onAbort, { once: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          finish({ ok: false, output: capText(message, MAX_HOOK_OUTPUT_CHARS, OUTPUT_TRUNCATION_MARKER) });
        }
      });
    },
  };
}
