// computer_screenshot：元数据、平台闸门、输出解析、视觉闭环图像组装与失败收敛。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createScreenshotTool } from "../src/screen";
import { fakeRunner, stubCtx } from "./fake";

const ctx = stubCtx();
const tempJpegs: string[] = [];

function writeTempJpeg(bytes: string): string {
  const file = path.join(os.tmpdir(), `innocence-screen-test-${Date.now()}-${Math.random()}.jpg`);
  fs.writeFileSync(file, bytes, "utf8");
  tempJpegs.push(file);
  return file;
}

afterEach(() => {
  for (const file of tempJpegs.splice(0)) fs.rmSync(file, { force: true });
});

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

  it("returns the archive path, scale formula and the downscaled image", async () => {
    const jpeg = writeTempJpeg("jpeg-bytes");
    const { runner, calls } = fakeRunner({
      stdout: `C:\\temp\\screen-1.png|1920x1080|${jpeg}|1280x720|0,0\r\n`,
    });
    const result = await createScreenshotTool({ runner }).execute({}, ctx);
    expect(result.content).toContain("C:\\temp\\screen-1.png (1920x1080)");
    expect(result.content).toContain("Returned image: 1280x720.");
    // 1920/1280 = 1.5 的换算式出现在文案里。
    expect(result.content).toContain("screen_x = image_x * 1.5 + 0");
    expect(result.images).toEqual([
      { mediaType: "image/jpeg", data: Buffer.from("jpeg-bytes", "utf8").toString("base64") },
    ]);
    expect(calls[0].script).toContain("SystemInformation]::VirtualScreen");
    expect(calls[0].script).toContain("CopyFromScreen");
    expect(calls[0].script).toContain("innocence-computer");
    expect(calls[0].signal).toBe(ctx.signal);
  });

  it("handles negative virtual-screen origins in the coordinate formula", async () => {
    const jpeg = writeTempJpeg("x");
    const { runner } = fakeRunner({
      stdout: `C:\\t\\s.png|3840x1080|${jpeg}|1280x360|-1920,0\r\n`,
    });
    const result = await createScreenshotTool({ runner }).execute({}, ctx);
    expect(result.content).toContain("screen_x = image_x * 3 + -1920");
    expect(result.content).toContain("screen_y = image_y * 3 + 0");
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
