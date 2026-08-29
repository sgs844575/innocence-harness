// plugin-hooks runner tests (batch 4C task 1): the process-layer hook
// executor with an injectable execFile — argument-array spawning, context
// environment variables, merged stderr on failure, timeout kill flag,
// and the 8KB output truncation marker.
import { describe, expect, it } from "vitest";
import type { HookDefinition } from "../src/config";
import {
  MAX_HOOK_OUTPUT_CHARS,
  MAX_HOOK_PREVIEW_CHARS,
  createHookRunner,
  type HookExecFile,
  type HookExecFileError,
  type HookExecFileOptions,
} from "../src/runner";

interface ObservedCall {
  file: string;
  args: string[];
  env: Record<string, string | undefined>;
}

function errorWith(code: number | string, message: string): HookExecFileError {
  return Object.assign(new Error(message), { code });
}

describe("createHookRunner", () => {
  it("spawns the split argument array with hook context environment", async () => {
    let observed: ObservedCall | undefined;
    const execFile: HookExecFile = (file, args, options, callback) => {
      observed = { file, args: [...args], env: options.env ?? {} };
      callback(null, "hook says hi", "");
      return { pid: undefined, kill() {} };
    };
    const hook: HookDefinition = {
      event: "preToolCall",
      command: "guard-hook --mode   strict",
    };
    const result = await createHookRunner({ execFile }).runHook(hook, {
      toolName: "Write",
      inputPreview: "src/a.ts",
    });
    expect(result).toEqual({ ok: true, output: "hook says hi" });
    expect(observed!.file).toBe("guard-hook");
    expect(observed!.args).toEqual(["--mode", "strict"]);
    expect(observed!.env.HOOK_EVENT).toBe("preToolCall");
    expect(observed!.env.HOOK_TOOL).toBe("Write");
    expect(observed!.env.HOOK_INPUT_PREVIEW).toBe("src/a.ts");
  });

  it("always provides the three context variables, empty when absent", async () => {
    let env: Record<string, string | undefined> | undefined;
    const execFile: HookExecFile = (_file, _args, options, callback) => {
      env = options.env ?? {};
      callback(null, "", "");
      return { pid: undefined, kill() {} };
    };
    await createHookRunner({ execFile }).runHook(
      { event: "sessionStart", command: "boot-hook" },
      {},
    );
    expect(env!.HOOK_EVENT).toBe("sessionStart");
    expect(env!.HOOK_TOOL).toBe("");
    expect(env!.HOOK_INPUT_PREVIEW).toBe("");
  });

  it("reports non-zero exits as failed with the merged stderr", async () => {
    const execFile: HookExecFile = (_file, _args, _options, callback) => {
      callback(errorWith(3, "process exited"), "partial stdout", "denied by policy");
      return { pid: undefined, kill() {} };
    };
    const result = await createHookRunner({ execFile }).runHook(
      { event: "preToolCall", command: "guard-hook" },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBeUndefined();
    expect(result.output).toContain("partial stdout");
    expect(result.output).toContain("denied by policy");
    expect(result.output).toContain("[exit 3]");
  });

  it("flags timeouts and kills the child", async () => {
    let killSignal: string | undefined;
    const execFile: HookExecFile = (_file, _args, _options, callback) => ({
      pid: undefined,
      kill(signal?: string) {
        killSignal = signal ?? "SIGTERM";
        const err = Object.assign(new Error("child was killed"), {
          killed: true,
          signal: killSignal,
        });
        callback(err, "", "");
      },
    });
    const result = await createHookRunner({ execFile }).runHook(
      { event: "userPromptSubmit", command: "slow-hook", timeoutMs: 50 },
      {},
    );
    expect(killSignal).toBe("SIGKILL");
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("clamps oversized output to the cap with the truncation marker", async () => {
    const loud = "x".repeat(10 * 1024);
    const execFile: HookExecFile = (_file, _args, _options, callback) => {
      callback(null, loud, "");
      return { pid: undefined, kill() {} };
    };
    const result = await createHookRunner({ execFile }).runHook(
      { event: "postToolCall", command: "loud-hook" },
      {},
    );
    expect(result.output.length).toBe(MAX_HOOK_OUTPUT_CHARS);
    expect(result.output.endsWith("[hook output truncated]")).toBe(true);
  });

  it("caps the input preview carried into the environment", async () => {
    let preview: string | undefined;
    const execFile: HookExecFile = (_file, _args, options, callback) => {
      preview = options.env?.HOOK_INPUT_PREVIEW;
      callback(null, "", "");
      return { pid: undefined, kill() {} };
    };
    await createHookRunner({ execFile }).runHook(
      { event: "userPromptSubmit", command: "inject-hook" },
      { inputPreview: "y".repeat(2000) },
    );
    expect(preview!.length).toBe(MAX_HOOK_PREVIEW_CHARS);
    expect(preview!.endsWith("[preview truncated]")).toBe(true);
  });

  it("surfaces spawn failures as failed output with the error message", async () => {
    const execFile: HookExecFile = (_file, _args, _options, callback) => {
      callback(errorWith("ENOENT", "spawn failed for missing executable"), "", "");
      return { pid: undefined, kill() {} };
    };
    const result = await createHookRunner({ execFile }).runHook(
      { event: "sessionStart", command: "missing-hook --flag" },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBeUndefined();
    expect(result.output).toContain("spawn failed for missing executable");
  });

  it("refuses blank commands without touching the process layer", async () => {
    let spawnCount = 0;
    const execFile: HookExecFile = (_file, _args, _options, callback) => {
      spawnCount += 1;
      callback(null, "", "");
      return { pid: undefined, kill() {} };
    };
    const result = await createHookRunner({ execFile }).runHook(
      { event: "sessionStart", command: "   " },
      {},
    );
    expect(spawnCount).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("passes the workspace cwd into the process layer options", async () => {
    let observed: HookExecFileOptions | undefined;
    const execFile: HookExecFile = (_file, _args, options, callback) => {
      observed = options;
      callback(null, "", "");
      return { pid: undefined, kill() {} };
    };
    await createHookRunner({ execFile }).runHook(
      { event: "sessionStart", command: "boot-hook" },
      { cwd: "D:/ws/root" },
    );
    expect(observed!.cwd).toBe("D:/ws/root");
  });

  it("reports the numeric exit code for explicit non-zero exits", async () => {
    const execFile: HookExecFile = (_file, _args, _options, callback) => {
      callback(errorWith(3, "process exited"), "", "");
      return { pid: undefined, kill() {} };
    };
    const result = await createHookRunner({ execFile }).runHook(
      { event: "preToolCall", command: "guard-hook" },
      {},
    );
    expect(result.exitCode).toBe(3);
  });

  it("leaves exitCode undefined on timeouts and spawn failures", async () => {
    const timedOut = await createHookRunner({
      execFile: (_file, _args, _options, callback) => ({
        pid: undefined,
        kill() {
          callback(Object.assign(new Error("killed"), { killed: true }), "", "");
        },
      }),
    }).runHook({ event: "preToolCall", command: "slow-hook", timeoutMs: 30 }, {});
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.exitCode).toBeUndefined();

    const missing = await createHookRunner({
      execFile: (_file, _args, _options, callback) => {
        callback(errorWith("ENOENT", "spawn failed"), "", "");
        return { pid: undefined, kill() {} };
      },
    }).runHook({ event: "preToolCall", command: "ghost-hook" }, {});
    expect(missing.ok).toBe(false);
    expect(missing.exitCode).toBeUndefined();
  });

  it("passes bounded spawn options without a shell", async () => {
    let observedOptions: HookExecFileOptions | undefined;
    const execFile: HookExecFile = (_file, _args, options, callback) => {
      observedOptions = options;
      callback(null, "", "");
      return { pid: undefined, kill() {} };
    };
    await createHookRunner({ execFile }).runHook(
      { event: "sessionStart", command: "boot-hook" },
      {},
    );
    expect(observedOptions!.windowsHide).toBe(true);
    expect(typeof observedOptions!.maxBuffer).toBe("number");
  });
});
