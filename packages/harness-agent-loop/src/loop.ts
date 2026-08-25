import { ContextManager } from "@innocenceharness/harness-session";
import { createExecutionScope, type ExecutionScopeIdentity } from "@innocenceharness/harness-tools";
import type { HarnessEventListener } from "@innocenceharness/harness-session";
import { PermissionEngine } from "@innocenceharness/harness-permissions";
import type { PermissionRequest, PermissionResource } from "@innocenceharness/harness-permissions";
import type {
  FinishReason,
  Provider,
  ProviderModel,
  ToolSpec,
  TurnCompletion,
  TurnMetadata,
  UsageMetadata,
} from "@innocenceharness/harness-providers";
import {
  executeToolInvocation,
  isAbortError,
  toolErrorOutcome,
  type ToolOutcome,
} from "@innocenceharness/harness-tools";
import type { Message, MessagePart, ToolCallPart, ToolResultPart } from "@innocenceharness/harness-session";
import type { Tool, ToolContext, ToolsService } from "@innocenceharness/harness-tools";
import { bindSubagentSpawner, type SubagentSpawner } from "@innocenceharness/harness-agent";
import { streamOneHarnessStep, type TraceAdapter } from "@innocenceharness/harness-ai-runtime";

export interface LoopOptions {
  provider: Provider;
  tools: ToolsService;
  permission: PermissionEngine;
  systemPrompt: string;
  workspaceRoot: string;
  onEvent: HarnessEventListener;
  compactor?: ContextManager;
  signal?: AbortSignal;
  maxTurns?: number;
  toolTimeoutMs?: number;
  /** Extra wait after the timeout abort before a tool is declared unstable. */
  abortGraceMs?: number;
  spawner?: SubagentSpawner;
  /**
   * Run-level identity inherited by every per-invocation scope minted in this
   * loop (sessionId/routeId/taskId/parentInvocationId). Subagent children run
   * with the parent's identity plus the spawning invocation's id.
   */
  scope?: ExecutionScopeIdentity;
  /** Optional allow-listed observability port injected by the host. */
  telemetry?: TraceAdapter;
}

export interface LoopResult {
  turns: number;
  /** Text of the final assistant message (empty when aborted early). */
  finalText: string;
  aborted: boolean;
  /** Metadata from each completed native model step; legacy providers have none. */
  stepMetadata: TurnMetadata[];
  /** Finish reason emitted by the final native model step. */
  finishReason?: FinishReason;
  /** Cumulative normalized usage across native model steps. */
  usage?: UsageMetadata;
  /** The one sanitized terminal summary emitted to downstream layers. */
  completion: TurnCompletion;
}

export const DEFAULT_MAX_TURNS = 40;
export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

interface ModelStep {
  parts: MessagePart[];
  metadata?: TurnMetadata;
  aborted: boolean;
  error?: string;
}

interface ModelStepRequest {
  provider: Provider;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  onEvent?: HarnessEventListener;
  telemetry?: TraceAdapter;
}

/**
 * Streams exactly one model step. An opaque model carrier is preferred for
 * production execution; deterministic and legacy providers retain their
 * canonical chat path. Both paths return the same canonical parts so all
 * persistence, permission, and execution policy stays below this boundary.
 */
async function runModelStep(request: ModelStepRequest): Promise<ModelStep> {
  const model = providerModel(request.provider);
  const trace = model
    ? request.telemetry?.startModelStep({ providerId: model.providerId, modelId: model.modelId })
    : undefined;
  const completeTrace = (metadata: TurnMetadata | undefined, aborted: boolean, errored = false) => {
    if (!trace || !model) return;
    trace.complete({
      providerId: model.providerId,
      modelId: model.modelId,
      ...(metadata?.usage ? { usage: metadata.usage } : {}),
      finishReason: aborted ? "aborted" : errored ? "error" : metadata?.finishReason ?? "other",
      aborted,
      ...(metadata?.responseId ? { responseId: metadata.responseId } : {}),
    });
  };
  const parts: MessagePart[] = [];

  if (!model) {
    try {
      for await (const delta of request.provider.chat({
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        signal: request.signal,
      })) {
        if (delta.type === "text") {
          if (delta.text) {
            parts.push({ type: "text", text: delta.text });
            request.onEvent?.({ type: "token", text: delta.text });
          }
        } else if (delta.type === "thinking") {
          if (delta.text) {
            parts.push({ type: "thinking", text: delta.text });
            request.onEvent?.({ type: "thinking", text: delta.text });
          }
        } else if (delta.type === "toolCall") {
          parts.push({
            type: "toolCall",
            id: delta.id,
            toolName: delta.toolName,
            args: delta.args,
          });
        }
      }
    } catch (_error) {
      return request.signal?.aborted
        ? { parts, aborted: true }
        : { parts, aborted: false, error: "Model request failed" };
    }
    return { parts, aborted: request.signal?.aborted === true };
  }

  let metadata: TurnMetadata | undefined;
  let error: string | undefined;
  for await (const event of streamOneHarnessStep({
    model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    signal: request.signal,
  })) {
    switch (event.type) {
      case "text":
        if (event.text) {
          parts.push({ type: "text", text: event.text });
          request.onEvent?.({ type: "token", text: event.text });
        }
        break;
      case "reasoning":
        if (event.text) {
          parts.push({ type: "thinking", text: event.text });
          request.onEvent?.({ type: "thinking", text: event.text });
        }
        break;
      case "toolCall":
        parts.push({
          type: "toolCall",
          id: event.id,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "finish":
        metadata = event.metadata;
        break;
      case "abort":
        completeTrace(metadata, true);
        return { parts, metadata, aborted: true };
      case "error":
        // The runtime deliberately normalizes this message, so no provider
        // payload, prompt, credentials, or raw tool arguments escape here.
        error = event.error.message;
        break;
      case "usage":
      case "toolResult":
        // Tool definitions are schema-only. Result events have no execution
        // meaning at this boundary and cannot bypass the Harness executor.
        break;
    }
  }
  completeTrace(metadata, request.signal?.aborted === true, error !== undefined);
  return { parts, metadata, aborted: request.signal?.aborted === true, ...(error ? { error } : {}) };
}

/** Narrows the optional opaque-model extension without changing legacy providers. */
function providerModel(provider: Provider): ProviderModel | undefined {
  const candidate = provider as Provider & { model?: unknown };
  const model = candidate.model;
  if (!model || typeof model !== "object") return undefined;
  const value = model as Partial<ProviderModel>;
  return typeof value.providerId === "string" && typeof value.modelId === "string"
    ? value as ProviderModel
    : undefined;
}

/**
 * Context compaction still accepts the legacy provider contract. When a model
 * carrier is present, adapt one controlled model step to that contract rather
 * than falling through to a handwritten transport.
 */
function providerForCompaction(provider: Provider, telemetry?: TraceAdapter): Provider {
  if (!providerModel(provider)) return provider;
  return {
    id: provider.id,
    async *chat(request) {
      const step = await runModelStep({
        provider,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        signal: request.signal,
        telemetry,
      });
      if (step.aborted) return;
      for (const part of step.parts) {
        if (part.type === "text") yield { type: "text", text: part.text };
        else if (part.type === "thinking") yield { type: "thinking", text: part.text };
        else if (part.type === "toolCall") {
          yield {
            type: "toolCall",
            id: part.id,
            toolName: part.toolName,
            args: part.args,
          };
        }
      }
    },
  };
}

/** Adds normalized token counts without retaining any provider wire metadata. */
function addUsage(total: UsageMetadata | undefined, next: UsageMetadata | undefined): UsageMetadata | undefined {
  if (!next) return total;
  const result: UsageMetadata = { ...total };
  let hasUsage = false;
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "reasoningTokens",
    "cachedInputTokens",
  ] as const) {
    const value = next[key];
    if (value === undefined) continue;
    result[key] = (result[key] ?? 0) + value;
    hasUsage = true;
  }
  return hasUsage || total ? result : undefined;
}

/**
 * The synchronous, readable agent loop: stream one model step, gate every tool
 * call through the permission engine, feed results back, repeat until the
 * model answers without tool calls. The input is the canonical user message
 * (already skill-expanded and processor-run by the session); tool-result user
 * turns pushed by the loop itself never pass through processors.
 */
export async function runLoop(
  history: Message[],
  input: Message,
  opts: LoopOptions,
): Promise<LoopResult> {
  const {
    provider,
    tools,
    permission,
    systemPrompt,
    workspaceRoot,
    onEvent,
    compactor,
    signal,
    telemetry,
  } = opts;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const toolTimeoutMs = opts.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  // Shallow copy: history owns its entries even when the caller reuses the
  // canonical Message object it passed in.
  history.push({ role: input.role, parts: [...input.parts] });

  const baseToolCtx = {
    workspaceRoot,
    signal: signal ?? new AbortController().signal,
    log: () => {}, // session installs a real logger over onEvent
  };

  let aborted = false;
  let turns = 0;
  const stepMetadata: TurnMetadata[] = [];
  let usage: UsageMetadata | undefined;
  let finishReason: FinishReason | undefined;
  let terminalError = false;
  const compactionProvider = providerForCompaction(provider, telemetry);

  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      if (signal?.aborted) break;
      turns = turn;
      onEvent({ type: "turnStart", turn });

      if (compactor) {
        const compacted = await compactor.maybeCompact(history, compactionProvider, signal);
        if (compacted) onEvent({ type: "compaction", removedMessages: history.length });
      }

      const step = await runModelStep({
        provider,
        system: systemPrompt,
        messages: history,
        tools: tools.specs(),
        signal,
        onEvent,
        telemetry,
      });
      if (step.metadata) {
        stepMetadata.push(step.metadata);
        usage = addUsage(usage, step.metadata.usage);
        finishReason = step.metadata.finishReason;
      }
      if (step.aborted) {
        aborted = true;
        break;
      }
      if (step.error) {
        terminalError = true;
        onEvent({ type: "error", message: step.error, fatal: true });
        break;
      }

      const parts = step.parts;
      if (parts.length === 0) break;

      const calls = parts.filter(
        (part): part is ToolCallPart => part.type === "toolCall",
      );

      /**
       * Per-call preparation, in the fixed executor-chain order:
       *   raw → validateArgs(raw) → permissionResource(raw) → persistArgs(raw)
       * persistArgs runs exactly ONCE per invocation; its output is the only
       * args shape allowed into history/events/permission/audit. Raw values
       * live only for this invocation and die with it.
       */
      interface PreparedCall {
        part: ToolCallPart;
        tool?: Tool;
        ctx?: ToolContext;
        resource?: PermissionResource;
        persistedArgs: Record<string, unknown>;
        failure?: string;
      }
      const prepared = new Map<string, PreparedCall>();
      for (const part of calls) {
        const tool = tools.get(part.toolName);
        if (!tool) {
          prepared.set(part.id, { part, tool: undefined, persistedArgs: {} });
          continue;
        }
        // Fresh scope per invocation — never a session-level reused one —
        // inheriting the run identity. The spawner handed to this invocation
        // is bound to the same scope so subagent children inherit it.
        const scope = createExecutionScope(tool.name, undefined, opts.scope);
        const invocationCtx: ToolContext = {
          ...baseToolCtx,
          scope,
          subagent: opts.spawner ? bindSubagentSpawner(opts.spawner, scope) : undefined,
        };
        try {
          await tool.validateArgs?.(part.args);
          const resource = await tool.permissionResource(part.args, invocationCtx);
          const persistedArgs = tool.persistArgs(part.args);
          prepared.set(part.id, { part, tool, ctx: invocationCtx, resource, persistedArgs });
        } catch (_error) {
          // Preparation functions receive raw args, so their diagnostics are
          // not safe to persist into history, events, audit, or transcripts.
          prepared.set(part.id, {
            part,
            tool,
            ctx: invocationCtx,
            persistedArgs: {},
            failure: "工具调用准备失败",
          });
        }
      }

      // Persisted assistant message: secrets from raw args never enter history.
      const toPersisted = (part: MessagePart): MessagePart =>
        part.type === "toolCall"
          ? { ...part, args: prepared.get(part.id)?.persistedArgs ?? {} }
          : part;
      history.push({ role: "assistant", parts: mergeTextParts(parts).map(toPersisted) });
      onEvent({ type: "assistantMessage", parts: parts.map(toPersisted) });

      if (calls.length === 0) break;

      const resultParts: ToolResultPart[] = [];
      for (const part of calls) {
        const item = prepared.get(part.id)!;
        const started = Date.now();
        const toolTrace = part.toolName.startsWith("mcp__")
          ? telemetry?.startMcpCall({
              sessionId: opts.scope?.sessionId,
              invocationId: item.ctx?.scope.invocationId,
            })
          : telemetry?.startToolInvocation({
              sessionId: opts.scope?.sessionId,
              taskId: opts.scope?.taskId,
              routeId: opts.scope?.routeId,
              invocationId: item.ctx?.scope.invocationId,
            });
        const invocationId = item.ctx?.scope.invocationId;
        const finish = (content: string, isError: boolean, outcome: ToolOutcome) => {
          resultParts.push({
            type: "toolResult",
            toolCallId: part.id,
            content,
            isError: isError || undefined,
          });
          onEvent({
            type: "toolResult",
            toolCallId: part.id,
            content,
            isError: isError || undefined,
            durationMs: Date.now() - started,
            invocationId,
            resource: item.resource,
            outcome,
          });
          toolTrace?.complete(outcome === "aborted" ? "aborted" : outcome === "error" ? "error" : "stop");
        };
        const failClosed = (content: string) => finish(content, true, "error");

        onEvent({
          type: "toolCall",
          id: part.id,
          call: { toolName: part.toolName, args: item.persistedArgs },
          invocationId,
        });

        // Stopped mid-turn: fail the remaining calls closed without touching
        // the permission chain — a stopped run must never prompt again. The
        // outcome is "aborted" (same rule as M3): user-stop terminations must
        // not inflate tool error rates in outcome-aggregating hosts.
        if (signal?.aborted) {
          finish("运行已中止", true, "aborted");
          continue;
        }

        if (!item.tool) {
          failClosed(`未知工具：${part.toolName}`);
          continue;
        }
        if (item.failure !== undefined) {
          failClosed(item.failure);
          continue;
        }

        const request: PermissionRequest = {
          toolName: item.tool.name,
          resource: item.resource!,
          args: item.persistedArgs,
        };
        let resolution;
        try {
          resolution = await permission.resolve(request, {
            readOnly: item.tool.readOnly,
            sideEffect: item.tool.sideEffect,
          });
        } catch (_error) {
          // Resource validation uses persisted values, but its diagnostic may
          // still be provider/tool-controlled; keep transcript output neutral.
          failClosed("资源校验未通过");
          continue;
        }
        onEvent({
          type: "permission",
          id: part.id,
          toolName: part.toolName,
          resolution,
        });

        if (resolution.decision === "deny") {
          failClosed(`权限被拒绝：${resolution.reason}`);
          continue;
        }

        // Permission granted: hand the invocation to the executor, which owns
        // the derived AbortController, middleware chain, real abort-on-timeout
        // and outcome standardization. Raw args stay in this closure and die
        // with it.
        try {
          const result = await executeToolInvocation(
            {
              toolName: item.tool.name,
              persistedArgs: item.persistedArgs,
              ctx: item.ctx!,
              parentSignal: signal,
            },
            tools.middlewares(),
            {
              timeoutMs: toolTimeoutMs,
              abortGraceMs: opts.abortGraceMs,
              execute: (_signal, ctx) => item.tool!.execute(part.args, ctx),
            },
          );
          finish(
            result.content,
            result.isError === true,
            result.isError === true ? "error" : "success",
          );
        } catch (err) {
          // Tool failures feed back to the model instead of killing the loop.
          // With the run stopped, any failure shape counts as aborted. Do not
          // persist executor diagnostics: real tools received raw args.
          const outcome = toolErrorOutcome(err, { parentAborted: signal?.aborted === true });
          finish(safeToolFailureMessage(outcome), true, outcome);
        }
      }
      history.push({ role: "user", parts: resultParts });
    }
  } catch (err) {
    if (isAbortError(err)) {
      aborted = true;
    } else {
      terminalError = true;
      onEvent({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        fatal: true,
      });
    }
  }

  // A mid-tool stop surfaces as aborted tool results that never throw: the
  // loop flag must reflect the signal at exit, not just thrown abort errors.
  if (signal?.aborted) aborted = true;

  const last = [...history].reverse().find((message) => message.role === "assistant");
  const finalText =
    last?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
  const finalStep = stepMetadata.at(-1);
  const completion: TurnCompletion = {
    ...(finalStep?.providerId ? { providerId: finalStep.providerId } : {}),
    ...(finalStep?.modelId ? { modelId: finalStep.modelId } : {}),
    ...(usage ? { usage } : {}),
    finishReason: aborted ? "aborted" : terminalError ? "error" : finishReason ?? "stop",
    aborted,
    ...(finalStep?.responseId ? { responseId: finalStep.responseId } : {}),
  };
  onEvent({ type: "done", turns, completion });
  return {
    turns,
    finalText,
    aborted,
    stepMetadata,
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
    completion,
  };
}

function safeToolFailureMessage(outcome: ToolOutcome): string {
  switch (outcome) {
    case "aborted":
      return "工具执行已中止";
    case "timeout":
      return "工具执行超时";
    case "unstable":
      return "工具执行不稳定：TOOL_UNSTABLE";
    default:
      return "工具执行出错";
  }
}

/** Collapses consecutive text deltas into one part (readable history, clean transcripts). */
function mergeTextParts(parts: MessagePart[]): MessagePart[] {
  const merged: MessagePart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (part.type === "text" && last?.type === "text") {
      last.text += part.text;
    } else if (part.type === "thinking" && last?.type === "thinking") {
      last.text += part.text;
    } else {
      merged.push(part);
    }
  }
  return merged;
}
