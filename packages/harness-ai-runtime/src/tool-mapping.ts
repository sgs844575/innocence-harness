import type { JsonSchema, ToolSpec } from "@innocenceharness/harness-providers";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import { jsonSchema, tool, type Tool } from "ai";

export type SchemaOnlyTool = Tool<unknown, unknown>;
export type SchemaOnlyTools = Record<string, SchemaOnlyTool>;

export interface ToSdkToolsOptions {
  /**
   * Provider options attached to the LAST tool only (spec order preserved).
   * The anthropic protocol uses this for a cache breakpoint on the tool block
   * so the (largest, most stable) prefix stays cached even when the system
   * prompt differs between requests.
   */
  lastToolProviderOptions?: SharedV3ProviderOptions;
}

/**
 * Converts canonical tool specifications into model-visible schemas only.
 * Execution remains absent so callers must send every tool call through their
 * own permission and execution policy.
 */
export function toSdkTools(
  specs: readonly ToolSpec[],
  options?: ToSdkToolsOptions,
): SchemaOnlyTools {
  const lastToolOptions = options?.lastToolProviderOptions;
  return Object.fromEntries(
    specs.map((spec, index) => [
      spec.name,
      tool({
        description: spec.description,
        inputSchema: jsonSchema<unknown>(spec.parameters as JsonSchema),
        outputSchema: jsonSchema<unknown>({}),
        ...(index === specs.length - 1 && lastToolOptions
          ? { providerOptions: lastToolOptions }
          : {}),
      }),
    ]),
  );
}
