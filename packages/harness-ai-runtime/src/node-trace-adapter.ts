import {
  ConsoleSpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createTraceAdapter, type TraceAdapter } from "./telemetry";

export interface NodeTraceAdapter extends TraceAdapter {
  /** Flushes and releases the host-owned trace provider and its processors. */
  dispose(): Promise<void>;
}

export interface NodeTraceAdapterOptions {
  instrumentationName: string;
  /** Explicit processor set supplied by the host composition root. */
  spanProcessors: SpanProcessor[];
}

/** Creates the default processor set for hosts that record trace events to their log sink. */
export function createDefaultNodeTraceProcessors(): SpanProcessor[] {
  return [new SimpleSpanProcessor(new ConsoleSpanExporter())];
}

/** Creates the Node tracing adapter with host-provided processors and async cleanup. */
export function createNodeTraceAdapter(options: NodeTraceAdapterOptions): NodeTraceAdapter {
  const provider = new NodeTracerProvider({ spanProcessors: options.spanProcessors });
  provider.register();
  return {
    ...createTraceAdapter(provider.getTracer(options.instrumentationName)),
    dispose: () => provider.shutdown(),
  };
}
