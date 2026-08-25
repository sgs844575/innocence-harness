import type { Span, Tracer } from "@opentelemetry/api";
import type { FinishReason, TurnCompletion } from "@innocenceharness/harness-providers";

export interface TraceCompletionHandle {
  complete(completion: Pick<TurnCompletion, "providerId" | "modelId" | "usage" | "finishReason" | "aborted" | "responseId">): void;
}

export interface TraceFinishHandle {
  complete(finishReason: FinishReason): void;
}

export interface TraceAdapter {
  startModelStep(input: Pick<TurnCompletion, "providerId" | "modelId">): TraceCompletionHandle;
  startToolInvocation(input: {
    sessionId?: string;
    taskId?: string;
    routeId?: string;
    invocationId?: string;
  }): TraceFinishHandle;
  startMcpCall(input: { sessionId?: string; invocationId?: string }): TraceFinishHandle;
  startSessionRoute(input: {
    sessionId?: string;
    taskId?: string;
    routeId?: string;
    messageId?: string;
  }): TraceCompletionHandle;
}

/**
 * Creates a trace adapter with an explicit attribute allow-list. Callers supply
 * opaque IDs only; request content, credentials, tool arguments, and transport
 * payloads have no parameter position and cannot be attached accidentally.
 */
export function createTraceAdapter(tracer: Tracer): TraceAdapter {
  return {
    startModelStep(input) {
      const span = tracer.startSpan("harness.model.step");
      setOptional(span, "harness.provider.id", input.providerId);
      setOptional(span, "harness.model.id", input.modelId);
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
      return finishHandle(span);
    },
    startMcpCall(input) {
      const span = tracer.startSpan("harness.mcp.call");
      setOptional(span, "harness.session.id", input.sessionId);
      setOptional(span, "harness.invocation.id", input.invocationId);
      return finishHandle(span);
    },
    startSessionRoute(input) {
      const span = tracer.startSpan("harness.session.route");
      setScopeAttributes(span, input);
      setOptional(span, "harness.message.id", input.messageId);
      return {
        complete(completion) {
          setCompletionAttributes(span, completion);
          span.end();
        },
      };
    },
  };
}

function finishHandle(span: Span): TraceFinishHandle {
  return {
    complete(finishReason) {
      span.setAttribute("harness.finish.reason", finishReason);
      span.end();
    },
  };
}

function setCompletionAttributes(
  span: Span,
  completion: Pick<TurnCompletion, "providerId" | "modelId" | "usage" | "finishReason" | "aborted" | "responseId">,
): void {
  setOptional(span, "harness.provider.id", completion.providerId);
  setOptional(span, "harness.model.id", completion.modelId);
  span.setAttribute("harness.finish.reason", completion.finishReason);
  setOptional(span, "harness.response.id", completion.responseId);
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
