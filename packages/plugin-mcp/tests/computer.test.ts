import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { Context } from "@innocenceharness/kernel";
import { LoggerPlugin } from "@innocenceharness/kernel-logger";
import { ToolsPlugin, createExecutionScope, type ToolContext } from "@innocenceharness/harness-tools";
import { createMcpPlugin, StdioJsonRpcClient, type McpPluginOptions } from "../src";
import { mapMcpResult } from "../src/result";

const fixture = fileURLToPath(new URL("./fixtures/echo-server.mjs", import.meta.url));
const server = { command: process.execPath, args: [fixture] };
const context: ToolContext = {
  workspaceRoot: ".", signal: new AbortController().signal, log: () => {}, scope: createExecutionScope("test"),
};
const kernels: Context[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((kernel) => kernel.fiber.dispose()));
  vi.restoreAllMocks();
});
async function mount(options: McpPluginOptions): Promise<Context> {
  const kernel = new Context();
  kernels.push(kernel);
  await kernel.plugin(LoggerPlugin);
  await kernel.plugin(ToolsPlugin);
  await kernel.plugin(createMcpPlugin(options));
  return kernel;
}

describe("computer MCP integration", () => {
  it("reports desktop tool activity but does not announce unrelated tools or revoked calls", async () => {
    const finish = vi.fn();
    const begin = vi.fn(() => finish);
    let enabled = true;
    const kernel = await mount({ servers: { mixed: server }, computerActivity: { begin }, isComputerEnabled: () => enabled });
    await kernel.tools.get("mcp__mixed__echo")!.execute({ text: "ordinary" }, context);
    expect(begin).not.toHaveBeenCalled();
    await kernel.tools.get("mcp__mixed__computer_screenshot")!.execute({}, context);
    expect(begin).toHaveBeenCalledExactlyOnceWith({ toolName: "mcp__mixed__computer_screenshot", scope: context.scope, signal: context.signal });
    expect(finish).toHaveBeenCalledExactlyOnceWith("success");
    enabled = false;
    await kernel.tools.get("mcp__mixed__computer_screenshot")!.execute({}, context);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("does not launch named or explicitly marked desktop servers when disabled", async () => {
    const start = vi.spyOn(StdioJsonRpcClient.prototype, "start");
    const kernel = await mount({
      servers: { computer: server, "desktop-control": server, custom: { ...server, capability: "computer" } },
      isComputerEnabled: () => false,
    });
    expect(start).not.toHaveBeenCalled();
    expect(kernel.tools.specs()).toEqual([]);
  });

  it("filters desktop tools in mixed servers while retaining other tools", async () => {
    const kernel = await mount({ servers: { mixed: server }, isComputerEnabled: () => false });
    expect(kernel.tools.get("mcp__mixed__computer_screenshot")).toBeUndefined();
    expect(await kernel.tools.get("mcp__mixed__echo")!.execute({ text: "ready" }, context))
      .toMatchObject({ content: "echo: ready", isError: false });
  });

  it("preserves screenshot images and prevents subsequent calls after disabling", async () => {
    let enabled = true;
    const kernel = await mount({ servers: { custom: { ...server, capability: "computer" } }, isComputerEnabled: () => enabled });
    const tool = kernel.tools.get("mcp__custom__computer_screenshot")!;
    expect(await tool.execute({}, context)).toEqual({
      content: "Captured screen", images: [{ mediaType: "image/png", data: "aW1hZ2U=" }], isError: false,
    });
    expect(await tool.execute({ imageOnly: true }, context)).toMatchObject({ content: "[The server returned an image]", images: expect.any(Array) });
    enabled = false;
    expect(await tool.execute({}, context)).toMatchObject({ content: "Computer control is disabled in Settings.", isError: true });
    expect(await kernel.tools.get("mcp__custom__echo")!.execute({ text: "blocked" }, context)).toMatchObject({ isError: true });
  });

  it("retains image data and error status while bounding text and ignoring malformed blocks", () => {
    const result = mapMcpResult({ isError: true, content: [
      null, { type: "text", text: "x".repeat(20_000) }, { type: "image", data: "broken" },
      { type: "image", mimeType: "image/jpeg", data: "aW1hZ2U=" },
    ] });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Tool output was cut at 16000 characters");
    expect(result.images).toEqual([{ mediaType: "image/jpeg", data: "aW1hZ2U=" }]);
  });
});
