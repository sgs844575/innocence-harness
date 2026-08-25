import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it } from "vitest";
import { createTraceAdapter } from "../src";

describe("observability adapter", () => {
  it("records only approved model and opaque correlation attributes", () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const telemetry = createTraceAdapter(provider.getTracer("test"));

    const model = telemetry.startModelStep({
      providerId: "provider-safe",
      modelId: "model-safe",
      prompt: "private prompt",
      apiKey: "api-key",
    } as never);
    model.complete({
      providerId: "provider-safe",
      modelId: "model-safe",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      aborted: false,
      responseId: "resp_opaque",
    });
    const tool = telemetry.startToolInvocation({
      sessionId: "sess_opaque",
      taskId: "task_opaque",
      routeId: "route_opaque",
      invocationId: "invoke_opaque",
      rawArgs: "raw-tool-args",
    } as never);
    tool.complete("stop");
    const mcp = telemetry.startMcpCall({
      sessionId: "sess_opaque",
      invocationId: "invoke_opaque",
      payload: "raw-mcp-payload",
    } as never);
    mcp.complete("stop");
    const route = telemetry.startSessionRoute({
      sessionId: "sess_opaque",
      taskId: "task_opaque",
      routeId: "route_opaque",
      messageId: "msg_opaque",
    });
    route.complete({ finishReason: "aborted", aborted: true });

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual([
      "harness.model.step",
      "harness.tool.invocation",
      "harness.mcp.call",
      "harness.session.route",
    ]);
    const attributes = Object.fromEntries(spans.flatMap((span) => Object.entries(span.attributes)));
    expect(attributes).toMatchObject({
      "harness.provider.id": "provider-safe",
      "harness.model.id": "model-safe",
      "harness.finish.reason": "aborted",
      "harness.usage.input_tokens": 3,
      "harness.usage.output_tokens": 5,
      "harness.usage.total_tokens": 8,
      "harness.response.id": "resp_opaque",
      "harness.session.id": "sess_opaque",
      "harness.task.id": "task_opaque",
      "harness.route.id": "route_opaque",
      "harness.message.id": "msg_opaque",
      "harness.invocation.id": "invoke_opaque",
    });
    const serialized = JSON.stringify(attributes);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("api-key");
    expect(serialized).not.toContain("raw-tool-args");
    expect(serialized).not.toContain("raw-mcp-payload");
  });
});
