import { describe, expect, it } from "vitest";
import type { TurnMetadata } from "@innocenceharness/harness-providers";
import {
  COMMIT_MESSAGE_SYSTEM,
  COMMIT_MESSAGE_TASK,
  CommitMessageSchema,
  createCommitMessageService,
  type StructuredOutputPort,
  type StructuredOutputRequest,
  type StructuredOutputResult,
} from "../src/index";

function fakePort(result: unknown) {
  const calls: StructuredOutputRequest<unknown>[] = [];
  const port: StructuredOutputPort = {
    generate: async <T>(input: StructuredOutputRequest<T>): Promise<StructuredOutputResult<T>> => {
      calls.push(input as StructuredOutputRequest<unknown>);
      if (result instanceof Error) throw result;
      return { object: result as T, metadata: {} as TurnMetadata };
    },
  };
  return { port, calls };
}

const context = "## git status\n M src/app.ts\n\n## git diff --stat\n src/app.ts | 2 +-";

describe("commit message service", () => {
  it("passes model, task + context user message, system prompt, and schema through to the port", async () => {
    const { port, calls } = fakePort({ message: "update app shell" });
    const service = createCommitMessageService(port);
    await service.generate({ model: {} as never, context });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toBe(COMMIT_MESSAGE_SYSTEM);
    expect(calls[0]!.schema).toBe(CommitMessageSchema);
    expect(calls[0]!.messages[0]?.parts[0]).toEqual({
      type: "text",
      text: `${COMMIT_MESSAGE_TASK}\n\n${context}`,
    });
  });

  it("cleans multiline and quoted model output down to one subject line", async () => {
    const { port } = fakePort({ message: "\n\n`feat: add commit popover`\n\nthis line explains too much" });
    const service = createCommitMessageService(port);
    const result = await service.generate({ model: {} as never, context });
    expect(result.message).toBe("feat: add commit popover");
  });

  it("strips double quotes and caps the subject at 200 chars", async () => {
    const long = `"${"x".repeat(300)}"`;
    const { port } = fakePort({ message: long });
    const service = createCommitMessageService(port);
    const result = await service.generate({ model: {} as never, context });
    expect(result.message).toBe("x".repeat(200));
  });

  it("throws when the cleaned subject is empty", async () => {
    const { port } = fakePort({ message: "\n `` \n" });
    const service = createCommitMessageService(port);
    await expect(service.generate({ model: {} as never, context })).rejects.toThrow("empty commit message");
  });

  it("propagates port failures unchanged", async () => {
    const { port } = fakePort(new Error("generation failed"));
    const service = createCommitMessageService(port);
    await expect(service.generate({ model: {} as never, context })).rejects.toThrow("generation failed");
  });
});
