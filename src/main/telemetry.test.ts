import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { describe, expect, it, vi } from "vitest";
import { createHostTelemetry } from "./telemetry";

describe("host telemetry composition", () => {
  it("wires an active exporter into production tracing and releases it on shutdown", async () => {
    const exporter = new InMemorySpanExporter();
    const shutdown = vi.spyOn(exporter, "shutdown");
    const telemetry = createHostTelemetry([new SimpleSpanProcessor(exporter)]);

    telemetry.startSessionRoute({ sessionId: "session_opaque", routeId: "main" }).complete({
      finishReason: "stop",
      aborted: false,
    });

    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(exporter.getFinishedSpans()[0]).toMatchObject({
      name: "harness.session.route",
      attributes: {
        "harness.session.id": "session_opaque",
        "harness.route.id": "main",
        "harness.finish.reason": "stop",
      },
    });

    await telemetry.dispose();

    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
