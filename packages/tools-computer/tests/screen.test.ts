// computer_screenshot：元数据、平台闸门、输出解析与失败收敛。
import { describe, expect, it } from "vitest";
import { createScreenshotTool } from "../src/screen";
import { fakeRunner, stubCtx } from "./fake";

const ctx = stubCtx();

describe("computer_screenshot", () => {
  it("declares read-only metadata and the screen resource", () => {
    const tool = createScreenshotTool({ runner: fakeRunner().runner });
    expect(tool.name).toBe("computer_screenshot");
    expect(tool.readOnly).toBe(true);
    expect(tool.sideEffect).toBe("none");
    expect(tool.parameters).toEqual({ type: "object" });
    expect(tool.permissionResource({}, ctx)).toEqual({
      action: "read",
      kind: "computer",
      scope: "screen",
    });
    expect(tool.persistArgs({ any: "thing" })).toEqual({});
  });

  it("rejects non-Windows hosts", async () => {
    const tool = createScreenshotTool({ runner: fakeRunner().runner, platform: "darwin" });
    await expect(tool.execute({}, ctx)).rejects.toThrow(
      "Computer control tools are only available on Windows hosts.",
    );
  });

  it("parses file path and resolution from capture output", async () => {
    const { runner, calls } = fakeRunner({
      stdout: "C:\\temp\\innocence-computer\\screen-1.png|1920x1080\r\n",
    });
    const result = await createScreenshotTool({ runner }).execute({}, ctx);
    expect(result.content).toBe("C:\\temp\\innocence-computer\\screen-1.png (1920x1080)");
    expect(calls[0].script).toContain("SystemInformation]::VirtualScreen");
    expect(calls[0].script).toContain("CopyFromScreen");
    expect(calls[0].script).toContain("innocence-computer");
    expect(calls[0].signal).toBe(ctx.signal);
  });

  it("surfaces non-zero exits with the stderr tail", async () => {
    const { runner } = fakeRunner({ exitCode: 1, stderr: "capture-boom" });
    const tool = createScreenshotTool({ runner });
    await expect(tool.execute({}, ctx)).rejects.toThrow("capture-boom");
  });

  it("reports timeouts as errors", async () => {
    const { runner } = fakeRunner({ exitCode: null, timedOut: true });
    const tool = createScreenshotTool({ runner });
    await expect(tool.execute({}, ctx)).rejects.toThrow(/timed out/i);
  });

  it("rejects unparsable capture output", async () => {
    const { runner } = fakeRunner({ stdout: "garbage\n" });
    const tool = createScreenshotTool({ runner });
    await expect(tool.execute({}, ctx)).rejects.toThrow(/unexpected output/i);
  });
});
