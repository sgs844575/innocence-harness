// 插件装配：经内核 Context + ToolsPlugin 验证注册面——win32 注册五个工具、
// 非 win32 一个不注册、默认装配在 Windows 宿主上通过持久化 SPI 闸门。
import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { ComputerPlugin } from "../src";

const TOOL_NAMES = [
  "computer_screenshot",
  "computer_click",
  "computer_type",
  "computer_key",
  "computer_scroll",
];

async function kernelWithTools(): Promise<Context> {
  const kernel = new Context();
  await kernel.plugin(ToolsPlugin);
  return kernel;
}

describe("ComputerPlugin", () => {
  it("exposes the staging id", () => {
    expect(ComputerPlugin.name).toBe("computer");
  });

  it("registers all five tools on win32", async () => {
    const kernel = await kernelWithTools();
    await ComputerPlugin.apply(kernel, "win32");
    for (const name of TOOL_NAMES) {
      expect(kernel.tools.get(name), name).toBeDefined();
    }
  });

  it("registers nothing on non-Windows hosts", async () => {
    const kernel = await kernelWithTools();
    await ComputerPlugin.apply(kernel, "darwin");
    for (const name of TOOL_NAMES) {
      expect(kernel.tools.get(name), name).toBeUndefined();
    }
  });

  it("passes the permission resource gate with the default assembly on Windows hosts", async () => {
    if (process.platform !== "win32") return;
    const kernel = await kernelWithTools();
    await ComputerPlugin.apply(kernel);
    expect(kernel.tools.specs().map((spec) => spec.name)).toEqual(TOOL_NAMES);
    for (const name of TOOL_NAMES) {
      const tool = kernel.tools.get(name);
      expect(typeof tool?.permissionResource, `${name} permissionResource`).toBe("function");
    }
  });
});
