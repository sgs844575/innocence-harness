import { describe, expect, it } from "vitest";
import { toSdkTools } from "../src/index";

const schema = {
  type: "object",
  properties: {
    command: { type: "string" },
  },
  required: ["command"],
};

describe("toSdkTools", () => {
  it("maps canonical tool specs without an execute callback", () => {
    const mapped = toSdkTools([{ name: "shell", description: "run", parameters: schema }]);
    expect(mapped.shell.execute).toBeUndefined();
  });

  it("preserves tool descriptions and input schemas for model selection", async () => {
    const mapped = toSdkTools([{ name: "shell", description: "run a command", parameters: schema }]);
    expect(mapped.shell.description).toBe("run a command");
    const inputSchema = mapped.shell.inputSchema as { jsonSchema: unknown };
    expect(inputSchema.jsonSchema).toEqual(schema);
  });
});
