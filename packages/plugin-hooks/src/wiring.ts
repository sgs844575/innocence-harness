// Hook wiring (batch 4C task 2, batch 5 stop face): composes the parsed
// hook definitions and the bounded runner into the session's extension
// surfaces — one message processor ("hooks", order -450: after the memory
// index pass at -500, before the conventionally-numbered host processors
// and reminders at 900), one tool middleware (the pre-call gate plus the
// post-call note around every tool invocation), and one teardown disposer
// (the sessionStop face — built by stop.ts from this wiring's shared
// pieces, returned to the plugin's apply as its startup disposer).
//
// Interception semantics (fail-open discipline): a pre-tool hook denies the
// call ONLY through its own explicit non-zero exit. Infrastructure failures
// — timeout kill, spawn error, a throwing executor — never block a tool;
// they degrade to a warning line injected on the next user turn. The
// processor likewise never throws: configuration problems surface as
// warning lines carried by the session-start block.
//
// Authorization semantics (final-review finding 1, fail-CLOSED): every hook
// command passes the first-encounter permission gate (gate.ts) before the
// runner is ever touched — a denied or unauthorizable command is skipped
// with a warning line on the same channels as execution failures, and the
// absence of the permissions service skips the command outright.
//
// Session semantics: the plugin instance is created per composition and its
// processor/middleware are inherited by child sessions (the spawner passes
// the pipeline and middleware chain down), which is deliberate — a hook is
// session-level policy, so child-agent inputs and tool calls pass the same
// gates, always bound to the same workspace root. Only the session-start
// block is one-shot per instance: the first session seen owns it (the
// memory-index precedent), so a child's first turn does not replay startup
// hooks.
import type { PermissionsService } from "@innocenceharness/harness-permissions";
import {
  messageText,
  type Message,
  type MessageProcessor,
  type MessageProcessorContext,
} from "@innocenceharness/harness-session";
import type {
  ToolExecutionInvocation,
  ToolExecutionMiddleware,
  ToolResult,
} from "@innocenceharness/harness-tools";
import { parseHookDefinitions, type HookDefinition, type ParsedHooks } from "./config";
import {
  createHookPermissionGate,
  type HookPermissionGate,
} from "./gate";
import { createHookRunner, type HookRunner, type HookRunInput, type HookRunResult } from "./runner";
import { createStopFace, type HookLogSink } from "./stop";
import {
  appendHookNote,
  formatHookFailure,
  renderContinuationReminder,
  renderHookVetoContent,
  renderPromptContextReminder,
  renderSessionStartReminder,
  renderWarningReminder,
} from "./wording";

/** Processor name on the session pipeline; also the middleware layer name. */
export const HOOKS_PROCESSOR_NAME = "hooks";
/** Pipeline position between the memory index (-500) and the host/reminder passes. */
export const HOOKS_PROCESSOR_ORDER = -450;

export interface HooksWiringOptions {
  /** Reads the raw "hooks" configuration; parsed once, then cached. */
  readonly getHooksConfig: () => Promise<unknown>;
  /** Resolves the workspace root used as every hook command's cwd. */
  readonly getWorkspaceRoot: () => string;
  /**
   * Reads the permissions spine for the first-encounter command gate
   * (finding 1): undefined while the fiber is absent — commands then
   * fail closed (skipped with a warning).
   */
  readonly getPermissions?: () => PermissionsService | undefined;
  /** Runner seam for tests; defaults to the real process-layer runner. */
  readonly runner?: HookRunner;
  /**
   * Stop-face log sink (batch 5): receives the summary and warning lines
   * for teardown-time commands. The plugin factory wires this to the
   * session's logger service; without a sink the stop face runs silently.
   */
  readonly log?: HookLogSink;
  /**
   * Quit-path bypass (batch 5): when the host reports it is shutting
   * down, the stop face is skipped entirely — an exiting process must not
   * spawn fresh hook children during teardown.
   */
  readonly isHostShuttingDown?: () => boolean;
}

export interface HooksWiring {
  readonly processor: MessageProcessor;
  readonly middleware: ToolExecutionMiddleware;
  /**
   * The session teardown point (batch 5): runs sessionStop hooks once per
   * wiring instance, fail-soft, with a bounded wait (see createHooksWiring).
   * The plugin's apply returns this as its startup disposer, so the kernel
   * fiber invokes it while the session unwinds.
   */
  readonly dispose: () => Promise<void>;
}

/** Data behind the one-time continuation note after a veto. */
interface ContinuationNote {
  readonly toolName: string;
  readonly command: string;
  readonly exitCode: number;
}

/** JSON preview of persisted args; never throws on unserializable values. */
function safePreview(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args) ?? "";
  } catch {
    return "[unserializable args]";
  }
}

export function createHooksWiring(options: HooksWiringOptions): HooksWiring {
  const runner = options.runner ?? createHookRunner();
  const gate: HookPermissionGate = createHookPermissionGate(options);
  let cache: ParsedHooks | undefined;
  let firstSessionId: string | undefined;
  let firstTurn = true;
  let pendingWarnings: string[] = [];
  let pendingContinuation: ContinuationNote | null = null;

  const loadHooks = async (): Promise<ParsedHooks> => {
    if (cache === undefined) {
      try {
        cache = parseHookDefinitions(await options.getHooksConfig());
      } catch (error) {
        // Degrade, never throw: an unreadable config means no hooks plus
        // one warning line on the session-start block.
        const message = error instanceof Error ? error.message : String(error);
        cache = { hooks: [], warnings: [`hooks config could not be read: ${message}`] };
      }
    }
    return cache;
  };

  // The runner resolves rather than rejects, but wiring stays defensive:
  // an unexpected throw is an infrastructure failure (warning, fail-open),
  // never a pipeline break.
  const runGuarded = async (hook: HookDefinition, input: HookRunInput): Promise<HookRunResult> => {
    try {
      return await runner.runHook(hook, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, output: message };
    }
  };

  const hasOutput = (result: HookRunResult): boolean => result.output.trim().length > 0;

  // Stop face (batch 5): the teardown disposer is built from this wiring's
  // shared pieces (config cache, gate, guarded runner) — see stop.ts for
  // the fail-soft and bounded-wait contract.
  const dispose = createStopFace({
    gate,
    loadHooks,
    runGuarded,
    getWorkspaceRoot: options.getWorkspaceRoot,
    ...(options.log !== undefined ? { log: options.log } : {}),
    ...(options.isHostShuttingDown !== undefined
      ? { isHostShuttingDown: options.isHostShuttingDown }
      : {}),
  });

  const injectSessionStart = async (message: Message, signal?: AbortSignal): Promise<void> => {
    const parsed = await loadHooks();
    const outputs: string[] = [];
    const warnings: string[] = [...parsed.warnings];
    const cwd = options.getWorkspaceRoot();
    for (const hook of parsed.hooks) {
      if (hook.event !== "sessionStart") continue;
      const skip = await gate.authorize(hook);
      if (skip !== null) {
        warnings.push(skip);
        continue;
      }
      const result = await runGuarded(hook, { cwd, ...(signal !== undefined ? { signal } : {}) });
      if (result.ok && hasOutput(result)) outputs.push(result.output);
      else if (!result.ok) warnings.push(formatHookFailure(hook, result));
    }
    const block = renderSessionStartReminder(outputs, warnings);
    if (block !== undefined) message.parts.push({ type: "text", text: block });
  };

  const injectPromptContext = async (message: Message, signal?: AbortSignal): Promise<void> => {
    const parsed = await loadHooks();
    // Prefix matching reads the concatenated text: injections from earlier
    // processors are appended after the user's own words, so the original
    // input still forms the head of the string.
    const text = messageText(message);
    const blocks: string[] = [];
    if (pendingContinuation !== null) {
      blocks.push(
        renderContinuationReminder(
          pendingContinuation.toolName,
          pendingContinuation.command,
          pendingContinuation.exitCode,
        ),
      );
      pendingContinuation = null;
    }
    if (pendingWarnings.length > 0) {
      blocks.push(renderWarningReminder(pendingWarnings));
      pendingWarnings = [];
    }
    const failures: string[] = [];
    const cwd = options.getWorkspaceRoot();
    for (const hook of parsed.hooks) {
      if (hook.event !== "userPromptSubmit") continue;
      if (hook.match !== undefined && !text.startsWith(hook.match)) continue;
      const skip = await gate.authorize(hook);
      if (skip !== null) {
        failures.push(skip);
        continue;
      }
      const result = await runGuarded(hook, {
        inputPreview: text,
        cwd,
        ...(signal !== undefined ? { signal } : {}),
      });
      if (result.ok && hasOutput(result)) blocks.push(renderPromptContextReminder(result.output));
      else if (!result.ok) failures.push(formatHookFailure(hook, result));
    }
    if (failures.length > 0) blocks.push(renderWarningReminder(failures));
    for (const block of blocks) message.parts.push({ type: "text", text: block });
  };

  const processor: MessageProcessor = {
    name: HOOKS_PROCESSOR_NAME,
    order: HOOKS_PROCESSOR_ORDER,
    async process(message: Message, context: MessageProcessorContext): Promise<Message> {
      if (message.role !== "user") return message;
      firstSessionId ??= context.scope.sessionId;
      if (firstTurn && context.scope.sessionId === firstSessionId) {
        firstTurn = false;
        await injectSessionStart(message, context.signal);
        return message;
      }
      await injectPromptContext(message, context.signal);
      return message;
    },
  };

  const middleware: ToolExecutionMiddleware = {
    name: HOOKS_PROCESSOR_NAME,
    async execute(
      invocation: ToolExecutionInvocation,
      next: () => Promise<ToolResult>,
    ): Promise<ToolResult> {
      const parsed = await loadHooks();
      const matchesTool = (hook: HookDefinition): boolean =>
        hook.match === undefined || hook.match === invocation.toolName;
      const preHooks = parsed.hooks.filter(
        (hook) => hook.event === "preToolCall" && matchesTool(hook),
      );
      const postHooks = parsed.hooks.filter(
        (hook) => hook.event === "postToolCall" && matchesTool(hook),
      );
      if (preHooks.length === 0 && postHooks.length === 0) return next();
      const inputPreview = safePreview(invocation.persistedArgs);
      const cwd = options.getWorkspaceRoot();

      // Pre gate, serial: the first hook with an explicit non-zero exit
      // denies the call (veto result, tool never runs, continuation note
      // armed). Zero exits keep checking; infrastructure failures fail open
      // and queue a warning for the next user turn. A permission-gate skip
      // is neither — the hook simply never runs, the tool proceeds, and the
      // skip line rides the same deferred-warning channel.
      for (const hook of preHooks) {
        const skip = await gate.authorize(hook);
        if (skip !== null) {
          pendingWarnings.push(skip);
          continue;
        }
        const result = await runGuarded(hook, {
          toolName: invocation.toolName,
          inputPreview,
          cwd,
          signal: invocation.signal,
        });
        if (result.ok) continue;
        if (typeof result.exitCode === "number") {
          pendingContinuation = {
            toolName: invocation.toolName,
            command: hook.command,
            exitCode: result.exitCode,
          };
          return {
            content: renderHookVetoContent(hook.command, result.exitCode, result.output),
            isError: true,
          };
        }
        pendingWarnings.push(formatHookFailure(hook, result));
      }

      // next() is intentionally not wrapped: a tool's rejection propagates
      // through this layer untouched (post hooks observe completed results
      // only).
      const result = await next();

      // Post face, serial: output is appended at the result tail; failures
      // stay silent here — their warning line reaches the next user turn.
      let content = result.content;
      for (const hook of postHooks) {
        const skip = await gate.authorize(hook);
        if (skip !== null) {
          pendingWarnings.push(skip);
          continue;
        }
        const note = await runGuarded(hook, {
          toolName: invocation.toolName,
          inputPreview,
          cwd,
          signal: invocation.signal,
        });
        if (note.ok && hasOutput(note)) content = appendHookNote(content, note.output);
        else if (!note.ok) pendingWarnings.push(formatHookFailure(hook, note));
      }
      return content === result.content ? result : { ...result, content };
    },
  };

  return { processor, middleware, dispose };
}
