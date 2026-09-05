// 插件装配：经内核 Context + ToolsPlugin 验证注册面——win32 注册五个工具、
// 非 win32 一个不注册、默认装配在 Windows 宿主上通过持久化 SPI 闸门。
import { describe, expect, it, vi } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { ComputerPlugin } from "../src";
import { SkillsPlugin } from "@innocenceharness/harness-skills";
import { createExecutionScope, type ToolContext } from "@innocenceharness/harness-tools";
import * as runner from "../src/runner";

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
  it("announces native execution without exposing its typed content", async () => {
    const run = vi.spyOn(runner, "createPowershellRunner").mockReturnValue(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const kernel = await kernelWithTools();
    const finish = vi.fn();
    const begin = vi.fn(() => finish);
    try {
      await ComputerPlugin.apply(kernel, { platform: "win32", activity: { begin } });
      const context: ToolContext = {
        workspaceRoot: ".", signal: new AbortController().signal, log: () => {}, scope: createExecutionScope("computer_type"),
      };
      await kernel.tools.get("computer_type")!.execute({ text: "private typed content" }, context);
      expect(begin).toHaveBeenCalledExactlyOnceWith({ toolName: "computer_type", scope: context.scope, signal: context.signal });
      expect(finish).toHaveBeenCalledExactlyOnceWith("success");
    } finally {
      run.mockRestore();
      await kernel.fiber.dispose();
    }
  });

  it("registers the bundled skill and gates calls and skill loading after revocation", async () => {
    const kernel = await kernelWithTools();
    await kernel.plugin(SkillsPlugin);
    let enabled = true;
    await ComputerPlugin.apply(kernel, { platform: "win32", isEnabled: () => enabled });
    const skill = kernel.skills.get("computer-control")!;
    expect(await skill.loadBody()).toContain("Take a fresh screenshot");
    enabled = false;
    const context: ToolContext = {
      workspaceRoot: ".", signal: new AbortController().signal, log: () => {}, scope: createExecutionScope("test"),
    };
    for (const name of TOOL_NAMES) {
      expect(await kernel.tools.get(name)!.execute({}, context)).toMatchObject({ isError: true, content: "Computer control is disabled in Settings." });
    }
    await expect(skill.loadBody()).rejects.toThrow("disabled");
    await kernel.fiber.dispose();
  });

  it("registers neither tools nor the skill when access starts disabled", async () => {
    const kernel = await kernelWithTools();
    await kernel.plugin(SkillsPlugin);
    await ComputerPlugin.apply(kernel, { platform: "win32", isEnabled: () => false });
    expect(kernel.tools.specs()).toEqual([]);
    expect(kernel.skills.all()).toEqual([]);
    await kernel.fiber.dispose();
  });

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
