import type { JsonSchema, Tool, ToolResult } from "@innocenceharness/harness-tools";

/**
 * Tool definition shape produced by the reference harness `defineTool` DSL:
 * a `parameters` param map (not JSON Schema), an optional `output.render`
 * projecting the canonical return value into model-facing content parts, and
 * an `execute` returning the canonical value. The definitions registered
 * through the compatibility context are the DSL's output objects, so a
 * definition literal (no `defineTool` wrapper) is equally valid input here.
 */

/** One parameter of the reference harness param-map DSL. */
export interface DshToolParam {
  type?: string;
  required?: boolean;
  description?: string;
  /** Extra DSL fields (enum, items, …) pass through to the property. */
  [key: string]: unknown;
}

/** One content part returned by `output.render`. */
export interface DshContentPart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface DshToolDefinition {
  name: string;
  description?: string;
  /** Param map (per-parameter `{type, required, description, …}`) or an
   *  already-schema-shaped `{ type: "object", properties }` object. */
  parameters?: Record<string, unknown>;
  output?: {
    schema?: unknown;
    render?: (args: Record<string, unknown>, value: unknown) => DshContentPart[] | string | unknown;
  };
  execute?: (args: Record<string, unknown>) => unknown;
}

/**
 * Converts the param-map DSL into a JSON Schema object schema. `required`
 * hoists into the schema-level array; every other field (type, description,
 * enum, items, …) is kept on the property verbatim. A definition that already
 * carries an object schema (`type: "object"` + `properties`) passes through
 * unchanged.
 */
export function dshToolParameters(definition: DshToolDefinition): JsonSchema {
  const params = definition.parameters as { type?: unknown; properties?: unknown } | undefined;
  if (!params || typeof params !== "object" || Array.isArray(params)) return { type: "object" };
  if (params.type === "object" && params.properties && typeof params.properties === "object") {
    return params as unknown as JsonSchema;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      properties[key] = {};
      continue;
    }
    const { required: isRequired, ...property } = raw as DshToolParam;
    if (isRequired === true) required.push(key);
    properties[key] = property;
  }
  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema as JsonSchema;
}

/**
 * Validates one definition enough to build a harness tool: a non-empty name
 * and a callable `execute`. Throws with the offending field so the failure
 * record names the exact problem.
 */
export function assertDshToolDefinition(definition: DshToolDefinition): void {
  if (typeof definition.name !== "string" || definition.name.trim().length === 0) {
    throw new Error("tool definition has no name");
  }
  if (typeof definition.execute !== "function") {
    throw new Error(`tool ${definition.name}: execute is not a function`);
  }
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Projects one canonical `execute` value into harness tool-result content. */
function renderResult(
  definition: DshToolDefinition,
  args: Record<string, unknown>,
  value: unknown,
): ToolResult {
  const render = definition.output?.render;
  if (typeof render !== "function") {
    return { content: value === undefined ? "" : stringify(value) };
  }
  let parts: unknown;
  try {
    parts = render(args, value);
  } catch (err) {
    return { content: `tool ${definition.name} render failed: ${reasonOf(err)}`, isError: true };
  }
  if (typeof parts === "string") return { content: parts };
  if (!Array.isArray(parts)) return { content: stringify(parts) };
  const lines = parts.map((part) =>
    part && typeof part === "object" && typeof (part as DshContentPart).text === "string"
      ? (part as DshContentPart).text as string
      : stringify(part),
  );
  return { content: lines.join("\n") };
}

/**
 * Wraps one reference-harness tool definition as a harness Tool. External
 * plugin capability is unknown, so the tool is never read-only and carries
 * the most conservative side-effect class. Failures surface as `isError`
 * results (executor discipline: tools report, they never throw).
 */
export function createHarnessTool(definition: DshToolDefinition, pluginId: string): Tool {
  assertDshToolDefinition(definition);
  return {
    name: `dsh__${pluginId}__${definition.name}`,
    description: definition.description ?? `Reference-harness tool ${pluginId}/${definition.name}`,
    readOnly: false,
    sideEffect: "unknown",
    parameters: dshToolParameters(definition),
    permissionResource: () => ({
      action: "call",
      kind: "dsh",
      scope: `${pluginId}/${definition.name}`,
    }),
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const value = await definition.execute!(args);
        return renderResult(definition, args, value);
      } catch (err) {
        return {
          content: `Reference-harness tool ${definition.name} failed: ${reasonOf(err)}`,
          isError: true,
        };
      }
    },
  };
}
