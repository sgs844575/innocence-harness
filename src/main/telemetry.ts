import {
  createDefaultNodeTraceProcessors,
  createNodeTraceAdapter,
  type NodeTraceAdapter,
  type NodeTraceAdapterOptions,
} from "@innocenceharness/harness-electron";

/** Builds the host-owned tracing runtime with explicit processors and async cleanup. */
export function createHostTelemetry(
  spanProcessors: NodeTraceAdapterOptions["spanProcessors"] = createDefaultNodeTraceProcessors(),
): NodeTraceAdapter {
  return createNodeTraceAdapter({
    instrumentationName: "harness-runtime",
    spanProcessors,
  });
}
