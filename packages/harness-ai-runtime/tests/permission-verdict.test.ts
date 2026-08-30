import { describe, expect, it } from "vitest";
import type { TurnMetadata } from "@innocenceharness/harness-providers";
import {
  PERMISSION_VERDICT_SYSTEM,
  PermissionVerdictSchema,
  createPermissionVerdictService,
  type PermissionVerdictSubject,
  type StructuredOutputPort,
  type StructuredOutputRequest,
  type StructuredOutputResult,
} from "@innocenceharness/harness-ai-runtime";

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

const subject: PermissionVerdictSubject = {
  toolName: "Bash",
  resource: { action: "execute", kind: "command", scope: "sed" },
  args: { command: "sed", path: "src/a.ts" },
  readOnly: false,
  sideEffect: "process",
  recentDenials: [
    { toolName: "Edit", resource: { action: "write", kind: "path", scope: "src/a.ts" }, via: "denyRule", reason: "命中拒绝规则" },
  ],
};

describe("permission verdict service (S3)", () => {
  it("renders the subject JSON as the sole user message with the embedded system prompt and schema", async () => {
    const { port, calls } = fakePort({ decision: "ask", reason: "borderline edit" });
    const service = createPermissionVerdictService(port);
    await service.classify({ model: {} as never, subject });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(PERMISSION_VERDICT_SYSTEM);
    expect(calls[0].schema).toBe(PermissionVerdictSchema);
    const text = calls[0].messages[0]?.parts[0];
    const rendered = text && text.type === "text" ? text.text : "";
    // 不可信主体文本必须围栏包裹（提示注入加固）。
    expect(rendered.startsWith("```json\n")).toBe(true);
    expect(rendered).toContain('"toolName": "Bash"');
    expect(rendered).toContain('"scope": "src/a.ts"');
    expect(rendered).toContain("denyRule");
  });

  it("returns the parsed verdict with port metadata", async () => {
    const { port } = fakePort({ decision: "deny", reason: "circumvention via shell" });
    const service = createPermissionVerdictService(port);
    const result = await service.classify({ model: {} as never, subject });
    expect(result.verdict).toEqual({ decision: "deny", reason: "circumvention via shell" });
  });

  it("propagates port failures unchanged (caller escalates fail-closed)", async () => {
    const { port } = fakePort(new Error("generation failed"));
    const service = createPermissionVerdictService(port);
    await expect(service.classify({ model: {} as never, subject })).rejects.toThrow("generation failed");
  });

  it("system prompt carries the strict-review and circumvention cores", () => {
    expect(PERMISSION_VERDICT_SYSTEM).toContain("circumvention");
    expect(PERMISSION_VERDICT_SYSTEM).toContain("explicit confirmation");
    expect(PERMISSION_VERDICT_SYSTEM).toContain("ask");
  });
});
