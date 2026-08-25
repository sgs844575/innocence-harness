import type { JsonSchema, ToolSpec } from "@innocenceharness/harness-providers";
import { jsonSchema, tool, type Tool } from "ai";

export type SchemaOnlyTool = Tool<unknown, unknown>;
export type SchemaOnlyTools = Record<string, SchemaOnlyTool>;

/**
 * Converts canonical tool specifications into model-visible schemas only.
 * Execution remains absent so callers must send every tool call through their
 * own permission and execution policy.
 */
export function toSdkTools(specs: readonly ToolSpec[]): SchemaOnlyTools {
  return Object.fromEntries(
    specs.map((spec) => [
      spec.name,
      tool({
        description: spec.description,
        inputSchema: jsonSchema<unknown>(spec.parameters as JsonSchema),
        outputSchema: jsonSchema<unknown>({}),
      }),
    ]),
  );
}
