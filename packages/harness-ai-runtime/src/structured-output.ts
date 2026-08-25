import type { Message, ProviderModel, TurnMetadata } from "@innocenceharness/harness-providers";
import { generateText, Output, type LanguageModel } from "ai";
import type { z } from "zod";
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
export class StructuredOutputError extends Error {
  constructor() {
    super("Structured output validation failed");
    this.name = "StructuredOutputError";
  }
}

export function createStructuredOutputPort(): StructuredOutputPort {
  return {
    async generate<T>(input: StructuredOutputRequest<T>): Promise<StructuredOutputResult<T>> {
      try {
        const result = await generateText({
          model: input.model.value as LanguageModel,
          ...(input.system ? { system: input.system } : {}),
          messages: toSdkMessages(input.messages),
          abortSignal: input.signal,
          output: Output.object({ schema: input.schema }),
        });
        return {
          object: result.output,
          metadata: {
            providerId: input.model.providerId,
            modelId: input.model.modelId,
            usage: toUsageMetadata(result.usage),
            finishReason: result.finishReason,
          },
        };
      } catch {
        throw new StructuredOutputError();
      }
    },
  };
}
