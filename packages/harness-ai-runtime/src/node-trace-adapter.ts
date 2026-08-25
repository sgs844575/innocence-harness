import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { createTraceAdapter, type TraceAdapter } from "./telemetry";

export interface NodeTraceAdapterOptions {
  instrumentationName: string;
}

/** Creates and registers the Node tracing provider used by a host composition root. */
export function createNodeTraceAdapter(options: NodeTraceAdapterOptions): TraceAdapter {
  const provider = new NodeTracerProvider();
  provider.register();
  return createTraceAdapter(provider.getTracer(options.instrumentationName));
}
