import type { Message, ProviderModel, TurnMetadata } from "@innocenceharness/harness-providers";
import { generateText, NoObjectGeneratedError, Output, RetryError, type LanguageModel } from "ai";
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

/** A sanitized output error that never retains model text or provider payloads. */
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

  constructor(code: StructuredOutputErrorCode = "generation-failed") {
    super(ERROR_MESSAGES[code]);
    this.name = "StructuredOutputError";
    this.code = code;
  }
}

export function createStructuredOutputPort(): StructuredOutputPort {
  return {
    async generate<T>(input: StructuredOutputRequest<T>): Promise<StructuredOutputResult<T>> {
      if (input.signal?.aborted) throw new StructuredOutputError("aborted");
      if (input.model.capabilities?.structuredOutput === false) {
        throw new StructuredOutputError("provider-unsupported");
      }
      try {
        const result = await generateText({
          model: input.model.value as LanguageModel,
          ...(input.system ? { system: input.system } : {}),
          messages: toSdkMessages(input.messages),
          abortSignal: input.signal,
          output: Output.object({ schema: input.schema }),
        });
        if (result.finishReason === "length") {
          throw new StructuredOutputError("partial-output");
        }
        return {
          object: result.output,
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
  if (signal?.aborted) return new StructuredOutputError("aborted");
  if (error instanceof StructuredOutputError) return error;
  if (hasCause(
    error,
    (value) => NoObjectGeneratedError.isInstance(value) && value.finishReason === "length",
  )) {
    return new StructuredOutputError("partial-output");
  }
  if (hasCause(error, JSONParseError.isInstance)) return new StructuredOutputError("invalid-json");
  if (hasCause(error, TypeValidationError.isInstance)) return new StructuredOutputError("schema-mismatch");
  if (hasCause(error, UnsupportedFunctionalityError.isInstance)) {
    return new StructuredOutputError("provider-unsupported");
  }
  return new StructuredOutputError("generation-failed");
}

/** Inspects only an error-class tree; error text and payload fields never escape. */
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
  trigger: z.object({
    kind: z.enum(["schedule", "event", "manual"]),
    expression: z.string().min(1),
  }),
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
