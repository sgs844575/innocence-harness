import type { Message, ProviderModel, TurnMetadata } from "@innocenceharness/harness-providers";
import { generateObject, NoObjectGeneratedError, RetryError, type LanguageModel } from "ai";
import { JSONParseError, TypeValidationError, UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { z } from "zod";
import { toSdkMessages } from "./message-mapping";
import { toUsageMetadata } from "./metadata";

export interface StructuredOutputRequest<T> {
  model: ProviderModel;
  messages: readonly Message[];
  schema: z.ZodType<T>;
  system?: string;
  signal?: AbortSignal;
}

export interface StructuredOutputResult<T> {
  object: T;
  metadata: TurnMetadata;
}

export interface StructuredOutputPort {
  generate<T>(input: StructuredOutputRequest<T>): Promise<StructuredOutputResult<T>>;
}

export type StructuredOutputErrorCode =
  | "invalid-json"
  | "schema-mismatch"
  | "aborted"
  | "partial-output"
  | "provider-unsupported"
  | "generation-failed";

const ERROR_MESSAGES: Record<StructuredOutputErrorCode, string> = {
  "invalid-json": "Structured output was not valid JSON",
  "schema-mismatch": "Structured output did not match the required schema",
  aborted: "Structured output generation was aborted",
  "partial-output": "Structured output was incomplete",
  "provider-unsupported": "Structured output is not supported by this model",
  "generation-failed": "Structured output generation failed",
};

export class StructuredOutputError extends Error {
  readonly code: StructuredOutputErrorCode;

  constructor(code: StructuredOutputErrorCode = "generation-failed", cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : cause === undefined ? "" : String(cause);
    super(detail || ERROR_MESSAGES[code], cause === undefined ? undefined : { cause });
    this.name = "StructuredOutputError";
    this.code = code;
  }
}

/**
 * JSON-mode instruction sent twice — appended to the system prompt and again
 * as a final user message. Chat-completions compatible channels without
 * native structured-output support silently drop the JSON response format,
 * which leaves the model without any JSON constraint and it answers in prose.
 * Mid-tier and stronger models honor the system copy; smaller models follow
 * format instructions much more reliably in the user turn, so the schema
 * requirement rides both places — redundant on native channels, never
 * contradictory.
 */
function schemaInstruction(schema: z.ZodType<unknown>): string | undefined {
  try {
    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    return [
      "Output format requirement: your entire response must be one JSON object that",
      `conforms to this JSON Schema:\n${jsonSchema}`,
      "Output the JSON object only — no explanations, no markdown code fences, no",
      "text before or after it.",
    ].join("\n");
  } catch {
    return undefined;
  }
}

function systemWithInstruction(system: string | undefined, instruction: string | undefined): string | undefined {
  const combined = [system, instruction]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join("\n\n");
  return combined === "" ? undefined : combined;
}

function messagesWithInstruction(
  messages: readonly Message[],
  instruction: string | undefined,
): readonly Message[] {
  if (instruction === undefined) return messages;
  return [...messages, { role: "user", parts: [{ type: "text", text: instruction }] }];
}

/**
 * Repair hook for models that wrap the JSON object in prose or a markdown
 * code fence despite the prompt instruction: strips fences and returns the
 * first balanced JSON object found in the raw text.
 */
async function repairJsonText({ text }: { text: string }): Promise<string | null> {
  const unfenced = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1");
  const start = unfenced.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i += 1) {
    const char = unfenced[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}" && (depth -= 1) === 0) return unfenced.slice(start, i + 1);
  }
  return null;
}

export function createStructuredOutputPort(): StructuredOutputPort {
  return {
    async generate<T>(input: StructuredOutputRequest<T>): Promise<StructuredOutputResult<T>> {
      if (input.signal?.aborted) throw new StructuredOutputError("aborted");
      if (input.model.capabilities?.structuredOutput === false) {
        throw new StructuredOutputError("provider-unsupported");
      }
      const instruction = schemaInstruction(input.schema);
      const system = systemWithInstruction(input.system, instruction);
      try {
        const result = await generateObject({
          model: input.model.value as LanguageModel,
          ...(system !== undefined ? { system } : {}),
          messages: toSdkMessages(messagesWithInstruction(input.messages, instruction)),
          abortSignal: input.signal,
          schema: input.schema,
          experimental_repairText: repairJsonText,
        });
        if (result.finishReason === "length") {
          throw new StructuredOutputError("partial-output");
        }
        return {
          object: result.object,
          metadata: {
            providerId: input.model.providerId,
            modelId: input.model.modelId,
            usage: toUsageMetadata(result.usage),
            finishReason: result.finishReason,
            ...(result.response.id ? { responseId: result.response.id } : {}),
          },
        };
      } catch (error) {
        throw classifyStructuredOutputError(error, input.signal);
      }
    },
  };
}

function classifyStructuredOutputError(error: unknown, signal: AbortSignal | undefined): StructuredOutputError {
  if (signal?.aborted) return new StructuredOutputError("aborted", error);
  if (error instanceof StructuredOutputError) return error;
  if (hasCause(
    error,
    (value) => NoObjectGeneratedError.isInstance(value) && value.finishReason === "length",
  )) {
    return new StructuredOutputError("partial-output", error);
  }
  if (hasCause(error, JSONParseError.isInstance)) return new StructuredOutputError("invalid-json", error);
  if (hasCause(error, TypeValidationError.isInstance)) return new StructuredOutputError("schema-mismatch", error);
  if (hasCause(error, UnsupportedFunctionalityError.isInstance)) {
    return new StructuredOutputError("provider-unsupported", error);
  }
  return new StructuredOutputError("generation-failed", error);
}

/** Inspects the error-class tree while retaining the original failure as the cause. */
function hasCause(error: unknown, matches: (value: unknown) => boolean): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let depth = 0; pending.length > 0 && depth < 12; depth += 1) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (matches(current)) return true;
    if (RetryError.isInstance(current)) pending.push(...current.errors, current.lastError);
    if (typeof current === "object" && current !== null && "cause" in current) {
      pending.push((current as { cause?: unknown }).cause);
    }
  }
  return false;
}

export const AutomationCandidateSchema = z.object({
  trigger: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("schedule"),
      expression: z.string().min(1),
      everyMs: z.number().int().positive(),
    }),
    z.object({
      kind: z.literal("idle"),
      expression: z.string().min(1),
      idleForMs: z.number().int().positive(),
    }),
    z.object({
      kind: z.literal("manual"),
      expression: z.string().min(1),
    }),
  ]),
  actions: z.array(z.object({
    kind: z.enum(["run-command", "notify", "review"]),
    command: z.string().min(1),
  })).min(1),
  constraints: z.array(z.string().min(1)),
  reviewSummary: z.string().min(1),
});

export type AutomationCandidate = z.infer<typeof AutomationCandidateSchema>;

export interface AutomationCandidateRequest {
  model: ProviderModel;
  messages: readonly Message[];
  system?: string;
  signal?: AbortSignal;
}

export interface AutomationCandidateResult {
  candidate: AutomationCandidate;
  metadata: TurnMetadata;
}

export interface AutomationCandidateService {
  generate(input: AutomationCandidateRequest): Promise<AutomationCandidateResult>;
}

/**
 * Produces a reviewable automation proposal only. Confirmation, persistence,
 * scheduling, and execution deliberately belong to a separate host workflow.
 */
export function createAutomationCandidateService(
  output: StructuredOutputPort,
): AutomationCandidateService {
  return {
    async generate(input) {
      const result = await output.generate({
        ...input,
        schema: AutomationCandidateSchema,
      });
      return { candidate: result.object, metadata: result.metadata };
    },
  };
}
