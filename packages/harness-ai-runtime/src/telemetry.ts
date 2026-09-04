import type { Span, Tracer } from "@opentelemetry/api";
import type { FinishReason, TurnCompletion } from "@innocenceharness/harness-providers";

export interface TraceCompletionHandle {
  complete(completion: Pick<TurnCompletion, "providerId" | "modelId" | "usage" | "finishReason" | "aborted" | "responseId"> & {
    error?: string;
    response?: unknown;
  }): void;
}

export interface TraceFinishHandle {
  complete(finishReason: FinishReason, result?: unknown): void;
}

export interface TraceAdapter {
  startModelStep(input: Pick<TurnCompletion, "providerId" | "modelId"> & {
    system?: string;
    messages?: unknown;
    tools?: unknown;
  }): TraceCompletionHandle;
  startToolInvocation(input: {
    sessionId?: string;
    taskId?: string;
    routeId?: string;
    invocationId?: string;
    args?: Record<string, unknown>;
    resource?: unknown;
  }): TraceFinishHandle;
  startMcpCall(input: {
    sessionId?: string;
    invocationId?: string;
    args?: Record<string, unknown>;
    resource?: unknown;
  }): TraceFinishHandle;
  startSessionRoute(input: {
    sessionId?: string;
    taskId?: string;
    routeId?: string;
    messageId?: string;
    message?: unknown;
  }): TraceCompletionHandle;
}

/** Creates a trace adapter carrying complete invocation diagnostics. */
export function createTraceAdapter(tracer: Tracer): TraceAdapter {
  return {
    startModelStep(input) {
      const span = tracer.startSpan("harness.model.step");
      setOptional(span, "harness.provider.id", input.providerId);
      setOptional(span, "harness.model.id", input.modelId);
      setOptional(span, "harness.model.system", input.system);
      setSerialized(span, "harness.model.messages", input.messages);
      setSerialized(span, "harness.model.tools", input.tools);
      return {
        complete(completion) {
          setCompletionAttributes(span, completion);
          span.end();
        },
      };
    },
    startToolInvocation(input) {
      const span = tracer.startSpan("harness.tool.invocation");
      setScopeAttributes(span, input);
      setSerialized(span, "harness.tool.args", input.args);
      setSerialized(span, "harness.tool.resource", input.resource);
      return finishHandle(span, "harness.tool.result");
    },
    startMcpCall(input) {
      const span = tracer.startSpan("harness.mcp.call");
      setOptional(span, "harness.session.id", input.sessionId);
      setOptional(span, "harness.invocation.id", input.invocationId);
      setSerialized(span, "harness.mcp.args", input.args);
      setSerialized(span, "harness.mcp.resource", input.resource);
      return finishHandle(span, "harness.mcp.result");
    },
    startSessionRoute(input) {
      const span = tracer.startSpan("harness.session.route");
      setScopeAttributes(span, input);
      setOptional(span, "harness.message.id", input.messageId);
      setSerialized(span, "harness.message", input.message);
      return {
        complete(completion) {
          setCompletionAttributes(span, completion);
          span.end();
        },
      };
    },
  };
}

function finishHandle(span: Span, resultAttribute: string): TraceFinishHandle {
  return {
    complete(finishReason, result) {
      span.setAttribute("harness.finish.reason", finishReason);
      setSerialized(span, resultAttribute, result);
      span.end();
    },
  };
}

function setCompletionAttributes(
  span: Span,
  completion: Pick<TurnCompletion, "providerId" | "modelId" | "usage" | "finishReason" | "aborted" | "responseId"> & {
    error?: string;
    response?: unknown;
  },
): void {
  setOptional(span, "harness.provider.id", completion.providerId);
  setOptional(span, "harness.model.id", completion.modelId);
  span.setAttribute("harness.finish.reason", completion.finishReason);
  setOptional(span, "harness.response.id", completion.responseId);
  setOptional(span, "harness.error", completion.error);
  setSerialized(span, "harness.response", completion.response);
  setOptional(span, "harness.usage.input_tokens", completion.usage?.inputTokens);
  setOptional(span, "harness.usage.output_tokens", completion.usage?.outputTokens);
  setOptional(span, "harness.usage.total_tokens", completion.usage?.totalTokens);
  setOptional(span, "harness.usage.reasoning_tokens", completion.usage?.reasoningTokens);
  setOptional(span, "harness.usage.cached_input_tokens", completion.usage?.cachedInputTokens);
}

function setScopeAttributes(
  span: Span,
  input: { sessionId?: string; taskId?: string; routeId?: string; invocationId?: string },
): void {
  setOptional(span, "harness.session.id", input.sessionId);
  setOptional(span, "harness.task.id", input.taskId);
  setOptional(span, "harness.route.id", input.routeId);
  setOptional(span, "harness.invocation.id", input.invocationId);
}

function setOptional(span: Span, name: string, value: string | number | undefined): void {
  if (value !== undefined) span.setAttribute(name, value);
}

function setSerialized(span: Span, name: string, value: unknown): void {
  if (value === undefined) return;
  try {
    span.setAttribute(name, JSON.stringify(value));
  } catch {
    span.setAttribute(name, String(value));
  }
}
