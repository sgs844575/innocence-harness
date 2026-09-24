// plugin-hooks wiring tests (batch 4C task 2): the three faces that carry
// parsed hooks into the session — session-start first-turn injection with
// trailing parse warnings, prompt-submit context blocks with prefix
// matching, the pre/post tool middleware (explicit-exit denial, fail-open
// infrastructure failures, result-tail notes) — plus the one-time
// continuation note after a denial, child-session inheritance, and one
// real-process smoke through the factory (node -e over the default runner).
// Batch 5 adds the sessionStop face: the wiring-level dispose point runs
// stop hooks exactly once, fail-soft (failures and slow commands never
// break teardown), with output going to the log sink instead of the
// conversation, plus the host-shutdown bypass seam.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@innocenceharness/kernel";
import type { PermissionsService } from "@innocenceharness/harness-permissions";
import type {
  Message,
  MessageProcessor,
  MessageProcessorContext,
} from "@innocenceharness/harness-session";
import type {
  ToolExecutionInvocation,
  ToolExecutionMiddleware,
} from "@innocenceharness/harness-tools";
import { describe, expect, it } from "vitest";
import type { HookDefinition } from "../src/config";
import type { HookRunInput, HookRunResult, HookRunner } from "../src/runner";
import {
  HOOKS_PROCESSOR_NAME,
  HOOKS_PROCESSOR_ORDER,
  createHooksPlugin,
  createHooksWiring,
} from "../src";

/** Always-allowing fake permissions service (the gate's happy path). */
function allowAllPermissions(): PermissionsService {
  return {
    engine: {
      async resolve() {
        return { decision: "allow", via: "ask", reason: "fixture" };
      },
    },
  } as unknown as PermissionsService;
}

type FakeHandler = (
  hook: HookDefinition,
  input: HookRunInput,
) => HookRunResult | Promise<HookRunResult>;

function fakeRunner(handler: FakeHandler): HookRunner {
  return {
    runHook: (hook, input) => Promise.resolve().then(() => handler(hook, input)),
  };
}

const okRunner = fakeRunner(() => ({ ok: true, output: "" }));

function userMessage(text: string): Message {
  return { role: "user", parts: [{ type: "text", text }] };
}

function processorContext(sessionId: string): MessageProcessorContext {
  return {
    signal: new AbortController().signal,
    provider: {} as MessageProcessorContext["provider"],
    scope: { sessionId },
  };
}

function invocation(
  toolName: string,
  args: Record<string, unknown> = {},
): ToolExecutionInvocation {
  return {
    invocationId: "inv-1",
    toolName,
    args: args,
    signal: new AbortController().signal,
    scope: { invocationId: "inv-1", toolName },
  };
}

function textOf(message: Message): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

describe("sessionStart wiring", () => {
  it("injects one reminder block on the first user turn, hooks serially", async () => {
    const calls: string[] = [];
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "sessionStart", command: "boot-a" },
        { event: "sessionStart", command: "boot-b" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner((hook) => {
        calls.push(hook.command);
        return { ok: true, output: `${hook.command} context` };
      }),
    });
    const first = await wiring.processor.process(
      userMessage("start working"),
      processorContext("sess-1"),
    );
    const text = textOf(first);
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("[hook context (session start)]");
    expect(text).toContain("boot-a context");
    expect(text).toContain("boot-b context");
    expect(calls).toEqual(["boot-a", "boot-b"]);

    const second = await wiring.processor.process(
      userMessage("next"),
      processorContext("sess-1"),
    );
    expect(textOf(second)).not.toContain("(session start)");
    expect(calls).toEqual(["boot-a", "boot-b"]);
  });

  it("carries parse warnings as trailing warning lines of the block", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "onStop", command: "stopper" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: okRunner,
    });
    const message = await wiring.processor.process(
      userMessage("hi"),
      processorContext("sess-1"),
    );
    const text = textOf(message);
    expect(text).toContain("[hook warning]");
    expect(text).toContain("onStop");
  });

  it("surfaces a failed session-start hook as a warning line in the block", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "sessionStart", command: "broken-boot" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, output: "exploded at startup" })),
    });
    const message = await wiring.processor.process(
      userMessage("hi"),
      processorContext("sess-1"),
    );
    const text = textOf(message);
    expect(text).toContain("broken-boot");
    expect(text).toContain("exploded at startup");
  });
});

describe("userPromptSubmit wiring", () => {
  it("runs prefix-matched hooks on later turns with the workspace cwd", async () => {
    const seen: HookRunInput[] = [];
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "userPromptSubmit", command: "inject-review", match: "review" },
        { event: "userPromptSubmit", command: "inject-deploy", match: "deploy" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner((_hook, input) => {
        seen.push(input);
        return { ok: true, output: "review checklist loaded" };
      }),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const second = await wiring.processor.process(
      userMessage("review the parser"),
      processorContext("sess-1"),
    );
    const text = textOf(second);
    expect(text).toContain("[hook context]");
    expect(text).toContain("review checklist loaded");
    expect(seen).toHaveLength(1);
    expect(seen[0].cwd).toBe("D:/ws/root");
    expect(seen[0].inputPreview).toContain("review the parser");
  });

  it("reports a failed prompt hook as a warning block naming the command", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "userPromptSubmit", command: "flaky-inject" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, output: "cannot read hook state" })),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const second = await wiring.processor.process(
      userMessage("anything"),
      processorContext("sess-1"),
    );
    const text = textOf(second);
    expect(text).toContain("[hook warning]");
    expect(text).toContain("flaky-inject");
    expect(text).toContain("cannot read hook state");
  });

  it("applies prompt hooks to inherited child-session turns as well", async () => {
    let runs = 0;
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "userPromptSubmit", command: "child-gate" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => {
        runs += 1;
        return { ok: true, output: "child context" };
      }),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-parent"));
    const child = await wiring.processor.process(
      userMessage("child task"),
      processorContext("sess-child"),
    );
    const text = textOf(child);
    expect(runs).toBe(1);
    expect(text).toContain("child context");
    expect(text).not.toContain("(session start)");
  });

  it("parses the configuration once across turns and tool calls", async () => {
    let reads = 0;
    const wiring = createHooksWiring({
      getHooksConfig: async () => {
        reads += 1;
        return [];
      },
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: okRunner,
    });
    await wiring.processor.process(userMessage("a"), processorContext("sess-1"));
    await wiring.processor.process(userMessage("b"), processorContext("sess-1"));
    await wiring.middleware.execute(invocation("Read"), async () => ({ content: "ok" }));
    expect(reads).toBe(1);
  });
});

describe("preToolCall wiring", () => {
  it("blocks only on an explicit non-zero exit and arms a one-time note", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "preToolCall", command: "guard-write", match: "Write" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({
        ok: false,
        exitCode: 3,
        output: "policy refuses this write",
      })),
    });
    let nextCalls = 0;
    const result = await wiring.middleware.execute(invocation("Write"), async () => {
      nextCalls += 1;
      return { content: "written" };
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("guard-write");
    expect(result.content).toContain("3");
    expect(result.content).toContain("policy refuses this write");
    expect(result.content).toContain("Adjust the approach");
    expect(nextCalls).toBe(0);

    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const next = await wiring.processor.process(
      userMessage("continue"),
      processorContext("sess-1"),
    );
    const note = textOf(next);
    expect(note).toContain("[hook follow-up]");
    expect(note).toContain("Write");
    const after = await wiring.processor.process(
      userMessage("again"),
      processorContext("sess-1"),
    );
    expect(textOf(after)).not.toContain("[hook follow-up]");
  });

  it("lets a zero-exit guard pass through untouched", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "preToolCall", command: "quiet-guard", match: "Bash" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: true, output: "" })),
    });
    const result = await wiring.middleware.execute(
      invocation("Bash", { command: "git status" }),
      async () => ({ content: "ran fine" }),
    );
    expect(result).toEqual({ content: "ran fine" });
  });

  it("fails open on timeouts: the tool runs and a warning reaches the next turn", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "preToolCall", command: "slow-guard", match: "Bash" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, timedOut: true, output: "" })),
    });
    const result = await wiring.middleware.execute(invocation("Bash"), async () => ({
      content: "still ran",
    }));
    expect(result).toEqual({ content: "still ran" });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const next = await wiring.processor.process(
      userMessage("more"),
      processorContext("sess-1"),
    );
    const text = textOf(next);
    expect(text).toContain("[hook warning]");
    expect(text).toContain("slow-guard");
    expect(text).toContain("timed out");
  });

  it("fails open on spawn failures the same way", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "preToolCall", command: "ghost-guard" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, output: "spawn ENOENT" })),
    });
    const result = await wiring.middleware.execute(invocation("Read"), async () => ({
      content: "read anyway",
    }));
    expect(result).toEqual({ content: "read anyway" });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const next = await wiring.processor.process(
      userMessage("more"),
      processorContext("sess-1"),
    );
    expect(textOf(next)).toContain("ghost-guard");
  });

  it("skips the runner entirely when no hook matches the tool name", async () => {
    let runs = 0;
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "preToolCall", command: "write-only-guard", match: "Write" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => {
        runs += 1;
        return { ok: true, output: "" };
      }),
    });
    const result = await wiring.middleware.execute(invocation("Read"), async () => ({
      content: "read ok",
    }));
    expect(result).toEqual({ content: "read ok" });
    expect(runs).toBe(0);
  });
});

describe("postToolCall wiring", () => {
  it("appends a hook note at the tool result tail", async () => {
    const seen: HookRunInput[] = [];
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "postToolCall", command: "audit-write", match: "Write" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner((_hook, input) => {
        seen.push(input);
        return { ok: true, output: "audit row appended" };
      }),
    });
    const result = await wiring.middleware.execute(invocation("Write"), async () => ({
      content: "wrote 3 lines",
    }));
    expect(result.content).toContain("wrote 3 lines");
    expect(result.content).toContain("[hook note]");
    expect(result.content).toContain("audit row appended");
    expect(result.content.indexOf("wrote 3 lines")).toBeLessThan(
      result.content.indexOf("audit row appended"),
    );
    expect(seen[0].toolName).toBe("Write");
    expect(seen[0].cwd).toBe("D:/ws/root");
  });

  it("keeps a failed post hook silent in the result and defers the warning", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "postToolCall", command: "broken-audit" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, output: "audit store unreachable" })),
    });
    const result = await wiring.middleware.execute(invocation("Write"), async () => ({
      content: "wrote anyway",
    }));
    expect(result).toEqual({ content: "wrote anyway" });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    const next = await wiring.processor.process(
      userMessage("next"),
      processorContext("sess-1"),
    );
    expect(textOf(next)).toContain("broken-audit");
  });
});

describe("sessionStop wiring", () => {
  interface LogLine {
    level: "info" | "warn";
    message: string;
  }

  function logSink(): { lines: LogLine[]; log: (level: "info" | "warn", message: string) => void } {
    const lines: LogLine[] = [];
    return { lines, log: (level, message) => lines.push({ level, message }) };
  }

  it("runs stop hooks exactly once at the dispose point, serially, never on turns", async () => {
    const calls: string[] = [];
    const seen: HookRunInput[] = [];
    const sink = logSink();
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "sessionStop", command: "teardown-a" },
        { event: "sessionStop", command: "teardown-b" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner((hook, input) => {
        calls.push(hook.command);
        seen.push(input);
        return { ok: true, output: `${hook.command} sweep done` };
      }),
      log: sink.log,
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    expect(calls).toEqual([]);
    await wiring.dispose();
    await wiring.dispose();
    expect(calls).toEqual(["teardown-a", "teardown-b"]);
    expect(seen[0].cwd).toBe("D:/ws/root");
    expect(sink.lines.some((line) => line.level === "info" && line.message.includes("teardown-a"))).toBe(
      true,
    );
  });

  it("keeps a failed stop hook fail-soft: dispose resolves and the failure only logs", async () => {
    const sink = logSink();
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "sessionStop", command: "broken-teardown", timeoutMs: 5000 },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, exitCode: 2, output: "sweep store unreachable" })),
      log: sink.log,
    });
    await expect(wiring.dispose()).resolves.toBeUndefined();
    const warn = sink.lines.filter((line) => line.level === "warn");
    expect(warn.some((line) => line.message.includes("broken-teardown"))).toBe(true);
    expect(warn.some((line) => line.message.includes("2"))).toBe(true);
  });

  it("treats a timing-out stop hook the same way: warn log, dispose unaffected", async () => {
    const sink = logSink();
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "sessionStop", command: "slow-teardown" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, timedOut: true, output: "" })),
      log: sink.log,
    });
    await expect(wiring.dispose()).resolves.toBeUndefined();
    expect(sink.lines.some((line) => line.level === "warn" && line.message.includes("slow-teardown"))).toBe(
      true,
    );
  });

  it("releases the teardown wait at the bounded ceiling while a hook is still pending", async () => {
    const sink = logSink();
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "sessionStop", command: "hanging-teardown", timeoutMs: 25 },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      // Never settles: the dispose wait must give up at its own ceiling.
      runner: { runHook: () => new Promise<HookRunResult>(() => {}) },
      log: sink.log,
    });
    const started = performance.now();
    await expect(wiring.dispose()).resolves.toBeUndefined();
    expect(performance.now() - started).toBeLessThan(2000);
    expect(sink.lines.some((line) => line.level === "warn" && line.message.includes("25"))).toBe(true);
  });

  it("does nothing at dispose when no stop hooks are declared", async () => {
    let runs = 0;
    const sink = logSink();
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "sessionStart", command: "boot-hook" },
        { event: "userPromptSubmit", command: "inject-hook" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => {
        runs += 1;
        return { ok: true, output: "" };
      }),
      log: sink.log,
    });
    await expect(wiring.dispose()).resolves.toBeUndefined();
    expect(runs).toBe(0);
    expect(sink.lines).toEqual([]);
  });

  it("skips the stop face entirely when the host is shutting down", async () => {
    let runs = 0;
    const sink = logSink();
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "sessionStop", command: "teardown-hook" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => {
        runs += 1;
        return { ok: true, output: "" };
      }),
      log: sink.log,
      isHostShuttingDown: () => true,
    });
    await expect(wiring.dispose()).resolves.toBeUndefined();
    expect(runs).toBe(0);
    expect(sink.lines.some((line) => line.level === "info" && line.message.includes("shutting down"))).toBe(
      true,
    );
  });

  it("logs a permission-gate skip instead of running a denied stop command", async () => {
    let runs = 0;
    const sink = logSink();
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "sessionStop", command: "denied-teardown" }],
      getWorkspaceRoot: () => "D:/ws/root",
      runner: fakeRunner(() => {
        runs += 1;
        return { ok: true, output: "" };
      }),
      log: sink.log,
    });
    await expect(wiring.dispose()).resolves.toBeUndefined();
    expect(runs).toBe(0);
    expect(sink.lines.some((line) => line.level === "warn" && line.message.includes("denied-teardown"))).toBe(
      true,
    );
  });

  it("tolerates an absent log sink without breaking dispose", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "sessionStop", command: "quiet-teardown" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, output: "silent failure" })),
    });
    await expect(wiring.dispose()).resolves.toBeUndefined();
  });
});

describe("createHooksPlugin", () => {
  it("registers the processor and the middleware through the spine faces", () => {
    const processors: MessageProcessor[] = [];
    const middlewares: ToolExecutionMiddleware[] = [];
    const ctx = {
      session: { registerProcessor: (p: MessageProcessor) => processors.push(p) },
      tools: { registerMiddleware: (m: ToolExecutionMiddleware) => middlewares.push(m) },
      permissions: allowAllPermissions(),
      on: () => () => {},
    } as unknown as Context;
    createHooksPlugin({
      getHooksConfig: async () => [],
      getWorkspaceRoot: () => "D:/ws/root",
    }).apply(ctx);
    expect(processors).toHaveLength(1);
    expect(processors[0].name).toBe(HOOKS_PROCESSOR_NAME);
    expect(processors[0].order).toBe(HOOKS_PROCESSOR_ORDER);
    expect(middlewares).toHaveLength(1);
    expect(middlewares[0].name).toBe(HOOKS_PROCESSOR_NAME);
  });

  it("smokes one real hook through the process layer with the workspace cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "hooks-smoke-"));
    const processors: MessageProcessor[] = [];
    const ctx = {
      session: { registerProcessor: (p: MessageProcessor) => processors.push(p) },
      tools: { registerMiddleware: (_m: ToolExecutionMiddleware) => {} },
      permissions: allowAllPermissions(),
      on: () => () => {},
    } as unknown as Context;
    createHooksPlugin({
      // The -e payload stays one whitespace-free token: the command
      // tokenizer splits on spaces and supports no quoting forms.
      getHooksConfig: async () => [
        {
          event: "sessionStart",
          command: `${process.execPath} -e process.stdout.write('cwd='+process.cwd())`,
        },
      ],
      getWorkspaceRoot: () => root,
    }).apply(ctx);
    const message = await processors[0].process(
      userMessage("begin"),
      processorContext("sess-smoke"),
    );
    const text = textOf(message);
    expect(text).toContain("[hook context (session start)]");
    expect(text).toContain(`cwd=${root}`);
  });

  it("returns a stop disposer from apply and routes stop-face logs through ctx.logger", async () => {
    const processors: MessageProcessor[] = [];
    const entries: { level: string; message: string }[] = [];
    const ctx = {
      session: { registerProcessor: (p: MessageProcessor) => processors.push(p) },
      tools: { registerMiddleware: (_m: ToolExecutionMiddleware) => {} },
      permissions: allowAllPermissions(),
      on: () => () => {},
      logger: {
        log: (level: string, message: string) => entries.push({ level, message }),
      },
    } as unknown as Context;
    const plugin = createHooksPlugin({
      getHooksConfig: async () => [{ event: "sessionStop", command: "teardown-hook" }],
      getWorkspaceRoot: () => "D:/ws/root",
      runner: fakeRunner(() => ({ ok: true, output: "final sweep complete" })),
    });
    const dispose = plugin.apply(ctx);
    expect(typeof dispose).toBe("function");
    await dispose();
    expect(entries.some((entry) => entry.level === "info" && entry.message.includes("[hooks]"))).toBe(true);
    expect(entries.some((entry) => entry.message.includes("teardown-hook"))).toBe(true);
  });
});

describe("LLM hook conditions (final deferred)", () => {
  it("does not run the command when the evaluator returns ok:false; the tool remains allowed", async () => {
    const calls: string[] = [];
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "preToolCall", match: "Write", command: "conditional-guard", condition: "only when approved" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      conditionEvaluator: { evaluate: async () => ({ ok: false, reason: "insufficient evidence in transcript" }) },
      runner: fakeRunner((hook) => {
        calls.push(hook.command);
        return { ok: false, exitCode: 9, output: "should not run" };
      }),
    });
    const result = await wiring.middleware.execute(
      invocation("Write", { path: "src/a.ts" }),
      async () => ({ content: "write proceeds" }),
    );
    expect(result).toEqual({ content: "write proceeds" });
    expect(calls).toEqual([]);
  });
});

describe("turnEnd wiring", () => {
  it("runs turn-end hooks on the owning session's done event and injects output on the next turn", async () => {
    const calls: string[] = [];
    const seen: HookRunInput[] = [];
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "turnEnd", command: "turn-sweep" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner((hook, input) => {
        calls.push(hook.command);
        seen.push(input);
        return { ok: true, output: "turn summary line" };
      }),
    });
    // The owning session is learned from the first processor call.
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    expect(calls).toEqual([]);
    wiring.handleHarnessEvent({ type: "done", turns: 1 }, "sess-1");
    // Fire-and-forget: drain the microtask queue before asserting.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toEqual(["turn-sweep"]);
    expect(seen[0].cwd).toBe("D:/ws/root");
    const next = await wiring.processor.process(userMessage("second"), processorContext("sess-1"));
    const text = textOf(next);
    expect(text).toContain("[hook context (turn end)]");
    expect(text).toContain("turn summary line");
    // 注入一次即清：再下一轮不再出现。
    const third = await wiring.processor.process(userMessage("third"), processorContext("sess-1"));
    expect(textOf(third)).not.toContain("turn summary line");
  });

  it("ignores done events of other sessions and unattributed events", async () => {
    const calls: string[] = [];
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "turnEnd", command: "turn-sweep" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner((hook) => {
        calls.push(hook.command);
        return { ok: true, output: "" };
      }),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-owner"));
    wiring.handleHarnessEvent({ type: "done", turns: 1 }, "sess-other");
    wiring.handleHarnessEvent({ type: "done", turns: 1 });
    wiring.handleHarnessEvent({ type: "token", text: "x" }, "sess-owner");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toEqual([]);
  });

  it("routes turn-end failures to the deferred warning channel, never blocks", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "turnEnd", command: "broken-sweep" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({ ok: false, output: "exit 3" })),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    wiring.handleHarnessEvent({ type: "done", turns: 1 }, "sess-1");
    await new Promise<void>((resolve) => setImmediate(resolve));
    const next = await wiring.processor.process(userMessage("second"), processorContext("sess-1"));
    expect(textOf(next)).toContain("[hook warning]");
    expect(textOf(next)).toContain("broken-sweep");
  });

  it("subscribes harness events through the plugin apply and honors the fiber unsubscribe", async () => {
    const listeners: Array<(event: unknown, sessionId?: string) => void> = [];
    const calls: string[] = [];
    const processors: MessageProcessor[] = [];
    const unsubscribed: string[] = [];
    const ctx = {
      session: { registerProcessor: (p: MessageProcessor) => processors.push(p) },
      tools: { registerMiddleware: (_m: ToolExecutionMiddleware) => {} },
      permissions: allowAllPermissions(),
      on: (name: string, listener: (event: unknown, sessionId?: string) => void) => {
        listeners.push(listener);
        return () => unsubscribed.push(name);
      },
    } as unknown as Context;
    createHooksPlugin({
      getHooksConfig: async () => [{ event: "turnEnd", command: "sweep" }],
      getWorkspaceRoot: () => "D:/ws/root",
      runner: fakeRunner((hook) => {
        calls.push(hook.command);
        return { ok: true, output: "" };
      }),
    }).apply(ctx);
    expect(listeners).toHaveLength(1);
    await processors[0].process(userMessage("go"), processorContext("sess-1"));
    listeners[0]({ type: "done", turns: 1 }, "sess-1");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toEqual(["sweep"]);
    expect(unsubscribed).toEqual([]);
  });
});

describe("ecosystem matcher wiring (regex matchKind)", () => {
  it("fires a startup-source matcher and holds a resume-only matcher back", async () => {
    const calls: string[] = [];
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        {
          event: "sessionStart",
          command: "ecosystem-boot",
          match: "startup|clear|compact",
          matchKind: "regex",
        },
        {
          event: "sessionStart",
          command: "resume-only-boot",
          match: "^resume$",
          matchKind: "regex",
        },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner((hook) => {
        calls.push(hook.command);
        return { ok: true, output: "" };
      }),
    });
    await wiring.processor.process(userMessage("begin"), processorContext("sess-1"));
    expect(calls).toEqual(["ecosystem-boot"]);
  });

  it("unwraps an ecosystem additionalContext envelope on session start", async () => {
    const wiring = createHooksWiring({
      getHooksConfig: async () => [{ event: "sessionStart", command: "envelope-boot" }],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => ({
        ok: true,
        output: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: "Skill introduction loaded.",
          },
        }),
      })),
    });
    const message = await wiring.processor.process(
      userMessage("begin"),
      processorContext("sess-1"),
    );
    const text = textOf(message);
    expect(text).toContain("Skill introduction loaded.");
    expect(text).not.toContain("hookSpecificOutput");
    expect(text).not.toContain("additionalContext");
  });

  it("matches tool names with an alternation regex on both tool faces", async () => {
    const calls: string[] = [];
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "preToolCall", command: "edit-guard", match: "Write|Edit", matchKind: "regex" },
        { event: "postToolCall", command: "edit-audit", match: "Write|Edit", matchKind: "regex" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner((hook) => {
        calls.push(hook.command);
        return { ok: true, output: "guarded" };
      }),
    });
    const skipped = await wiring.middleware.execute(invocation("Read"), async () => ({
      content: "read ok",
    }));
    expect(skipped).toEqual({ content: "read ok" });
    expect(calls).toEqual([]);
    const result = await wiring.middleware.execute(invocation("Edit"), async () => ({
      content: "edited",
    }));
    expect(calls).toEqual(["edit-guard", "edit-audit"]);
    expect(result.content).toContain("[hook note]");
  });

  it("searches the whole prompt with a regex matcher instead of prefix-only", async () => {
    let runs = 0;
    const wiring = createHooksWiring({
      getHooksConfig: async () => [
        { event: "userPromptSubmit", command: "deploy-context", match: "deploy|ship it", matchKind: "regex" },
      ],
      getWorkspaceRoot: () => "D:/ws/root",
      getPermissions: () => allowAllPermissions(),
      runner: fakeRunner(() => {
        runs += 1;
        return { ok: true, output: "deploy checklist loaded" };
      }),
    });
    await wiring.processor.process(userMessage("first"), processorContext("sess-1"));
    // 前缀语义下 "please ship it now" 不会命中；正则搜索语义命中。
    const second = await wiring.processor.process(
      userMessage("please ship it now"),
      processorContext("sess-1"),
    );
    expect(runs).toBe(1);
    expect(textOf(second)).toContain("deploy checklist loaded");
  });
});
