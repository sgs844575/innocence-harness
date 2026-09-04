import { z } from "zod";
import type { Message, ProviderModel, TurnMetadata } from "@innocenceharness/harness-providers";
import type { StructuredOutputPort } from "./structured-output";

/** Structured subject line the commit-message model returns. */
export const CommitMessageSchema = z.object({
  message: z.string().min(1),
});

/**
 * System prompt of the commit-message model. English per the prompt language
 * rule; no third-party names.
 */
export const COMMIT_MESSAGE_SYSTEM = [
  "You write the subject line of a git commit. The user message carries a",
  "summary of the working tree: `git status --porcelain` output followed by",
  "a `git diff --stat` overview.",
  "",
  "Rules:",
  "- Output exactly one line: the commit subject, imperative mood, at most",
  "  72 characters.",
  "- No explanation, no quotes, no backticks, no trailing period.",
  "- Use a conventional-commit prefix (like \"feat:\" or \"fix:\") only when",
  "  the summary hints that the repository already follows that style;",
  "  otherwise write a plain subject.",
  "- Name the dominant change; when several areas changed at once, capture",
  "  the common theme instead of listing files.",
].join("\n");

export interface CommitMessageRequest {
  model: ProviderModel;
  /** Working-tree summary (git status + diff --stat) the subject is written from. */
  context: string;
  signal?: AbortSignal;
}

/** Task line prepended to the user message. Smaller models follow the task
 * statement far more reliably in the user turn than in the system prompt,
 * where a bare status summary reads as an unfinished chat request. */
export const COMMIT_MESSAGE_TASK =
  "Write the subject line of a git commit for the working tree summary below.";

export interface CommitMessageResult {
  message: string;
  metadata: TurnMetadata;
}

export interface CommitMessageService {
  generate(input: CommitMessageRequest): Promise<CommitMessageResult>;
}

/** First non-empty line, surrounding backticks/quotes stripped, 200-char cap. */
function cleanCommitMessage(text: string): string {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "") ?? "";
  const cleaned = line.replace(/^[`"']+|[`"']+$/g, "").trim().slice(0, 200);
  if (cleaned === "") throw new Error("empty commit message");
  return cleaned;
}

/**
 * Commit-subject service over the structured-output port: the working-tree
 * summary is the sole user message, the writing rules live in the embedded
 * system prompt. Model prose is reduced to one cleaned subject line; an
 * effectively empty answer is a hard failure.
 */
export function createCommitMessageService(output: StructuredOutputPort): CommitMessageService {
  return {
    async generate(input) {
      const result = await output.generate({
        model: input.model,
        schema: CommitMessageSchema,
        system: COMMIT_MESSAGE_SYSTEM,
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: `${COMMIT_MESSAGE_TASK}\n\n${input.context}` }],
          },
        ] satisfies Message[],
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return { message: cleanCommitMessage(result.object.message), metadata: result.metadata };
    },
  };
}
