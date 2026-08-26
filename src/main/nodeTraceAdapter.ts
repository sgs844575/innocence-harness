import {
  ConsoleSpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { createTraceAdapter, type TraceAdapter } from "@innocenceharness/harness-electron";

export interface NodeTraceAdapter extends TraceAdapter {
  dispose(): Promise<void>;
}

export interface NodeTraceAdapterOptions {
  instrumentationName: string;
  spanProcessors: SpanProcessor[];
}

export function createDefaultNodeTraceProcessors(): SpanProcessor[] {
  return [new SimpleSpanProcessor(new ConsoleSpanExporter())];
}

export function createNodeTraceAdapter(options: NodeTraceAdapterOptions): NodeTraceAdapter {
  const provider = new NodeTracerProvider({ spanProcessors: options.spanProcessors });
  provider.register();
  return {
    ...createTraceAdapter(provider.getTracer(options.instrumentationName)),
    dispose: () => provider.shutdown(),
  };
}
