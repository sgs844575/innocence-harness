// Hook command runner (batch 4C task 1): executes one parsed hook through
// the process layer with a plain argument array — no shell sits between
// the parsed tokens and the executable, so there is no string-concatenation
// injection surface. Combined output is bounded, merged and marked when
// truncated; a timeout kills the child tree following the shell-tool
// precedent (tree kill on win32, direct signal elsewhere). Hook output is
// additional context for the model, never a user instruction.
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
const OUTPUT_TRUNCATION_MARKER = "[hook output truncated]";
const PREVIEW_TRUNCATION_MARKER = "[preview truncated]";
/** Per-stream capture ceiling for the process layer; the visible budget
 *  above stays authoritative for the merged result. */
const SPAWN_MAX_BUFFER = 64 * 1024;

export interface HookRunInput {
  toolName?: string;
  inputPreview?: string;
}

export interface HookRunResult {
  ok: boolean;
  output: string;
  timedOut?: boolean;
}

export interface HookExecFileOptions {
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  maxBuffer?: number;
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

function clampTimeoutMs(timeoutMs: number | undefined): number {
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
      const timeoutMs = clampTimeoutMs(hook.timeoutMs);
      return new Promise<HookRunResult>((resolve) => {
        let timedOut = false;
        let settled = false;
        const finish = (result: HookRunResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        let child: HookChildProcess;
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, timeoutMs);
        try {
          child = execFileImpl(
            file,
            args,
            {
              env: buildEnvironment(hook, input),
              windowsHide: true,
              maxBuffer: SPAWN_MAX_BUFFER,
            },
            (error, stdout, stderr) => {
              const parts: string[] = [];
              if (stdout) parts.push(stdout);
              if (stderr) parts.push(stderr);
              if (error && !timedOut) {
                if (typeof error.code === "number") parts.push(`[exit ${error.code}]`);
                else parts.push(error.message);
              }
              finish({
                ok: error === null && !timedOut,
                output: capText(parts.join("\n"), MAX_HOOK_OUTPUT_CHARS, OUTPUT_TRUNCATION_MARKER),
                ...(timedOut ? { timedOut: true } : {}),
              });
            },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          finish({ ok: false, output: capText(message, MAX_HOOK_OUTPUT_CHARS, OUTPUT_TRUNCATION_MARKER) });
        }
      });
    },
  };
}
