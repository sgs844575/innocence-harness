// 四个输入工具：参数校验、资源与持久化形态、脚本关键片段断言、失败收敛、
// 平台闸门。全部经 fake runner 离线运行。
import { describe, expect, it } from "vitest";
import { createClickTool, createKeyTool, createScrollTool, createTypeTool } from "../src/input";
import { embeddedValue, fakeRunner, stubCtx } from "./fake";

const ctx = stubCtx();

describe("computer_click", () => {
  it("validates coordinates, button and double", () => {
    const tool = createClickTool({ runner: fakeRunner().runner });
    expect(() => tool.validateArgs!({})).toThrow(/"x"/);
    expect(() => tool.validateArgs!({ x: 1.5, y: 2 })).toThrow(/"x"/);
    expect(() => tool.validateArgs!({ x: -1, y: 2 })).toThrow(/"x"/);
    expect(() => tool.validateArgs!({ x: Number.NaN, y: 2 })).toThrow(/"x"/);
    expect(() => tool.validateArgs!({ x: Number.POSITIVE_INFINITY, y: 2 })).toThrow(/"x"/);
    expect(() => tool.validateArgs!({ x: 100_001, y: 0 })).toThrow(/"x"/);
    expect(() => tool.validateArgs!({ x: 10, y: Number.NaN })).toThrow(/"y"/);
    expect(() => tool.validateArgs!({ x: 10, y: 20, button: "side" })).toThrow(/button/);
    expect(() => tool.validateArgs!({ x: 10, y: 20, double: "yes" })).toThrow(/double/);
    expect(() => tool.validateArgs!({ x: 0, y: 0 })).not.toThrow();
  });

  it("exposes the execute/computer/input resource and persists the full args", () => {
    const tool = createClickTool({ runner: fakeRunner().runner });
    expect(tool.readOnly).toBe(false);
    expect(tool.sideEffect).toBe("unknown");
    expect(tool.permissionResource({ x: 3, y: 4 }, ctx)).toEqual({
      action: "execute",
      kind: "computer",
      scope: "input",
    });
  });

  it("emits the documented mouse_event flags", async () => {
    const { runner, calls } = fakeRunner();
    const tool = createClickTool({ runner });
    const result = await tool.execute({ x: 10, y: 20 }, ctx);
    expect(result.content).toContain("Clicked left button at (10, 20)");
    let script = calls[0].script;
    expect(script).toContain("SetCursorPos(10, 20)");
    expect(script).toContain("0x02");
    expect(script).toContain("0x04");
    expect(script).not.toContain("120");

    await tool.execute({ x: 10, y: 20, button: "right", double: true }, ctx);
    script = calls[1].script;
    expect(script).toContain("SetCursorPos(10, 20)");
    expect(script).toContain("0x08");
    expect(script).toContain("0x10");
    expect(script).toContain("Start-Sleep -Milliseconds 120");

    await tool.execute({ x: 10, y: 20, button: "middle" }, ctx);
    script = calls[2].script;
    expect(script).toContain("0x20");
    expect(script).toContain("0x40");
  });
});

describe("computer_type", () => {
  it("enforces text bounds and type", () => {
    const tool = createTypeTool({ runner: fakeRunner().runner });
    expect(() => tool.validateArgs!({})).toThrow(/"text"/);
    expect(() => tool.validateArgs!({ text: 42 })).toThrow(/"text"/);
    expect(() => tool.validateArgs!({ text: "" })).toThrow(/1 and 2000/);
    expect(() => tool.validateArgs!({ text: "x".repeat(2001) })).toThrow(/1 and 2000/);
    expect(() => tool.validateArgs!({ text: "x".repeat(2000) })).not.toThrow();
  });

  it("embeds the full text as base64 that decodes back", async () => {
    const text = "你好 world\nsecond line";
    const { runner, calls } = fakeRunner();
    const result = await createTypeTool({ runner }).execute({ text }, ctx);    expect(result.content).toContain("Typed 20 characters");
    const script = calls[0].script;
    expect(script).toContain("SendInput");
    expect(script).toContain("KEYEVENTF_UNICODE");
    expect(embeddedValue(script)).toBe(text);
  });
});

describe("computer_key", () => {
  it("rejects missing or unsupported keys", () => {
    const tool = createKeyTool({ runner: fakeRunner().runner });
    expect(() => tool.validateArgs!({})).toThrow(/"key"/);
    expect(() => tool.validateArgs!({ key: "" })).toThrow(/"key"/);
    expect(() => tool.validateArgs!({ key: "ctrl+alt+win" })).toThrow(/Unsupported key/);
  });

  it("embeds the mapped SendKeys sequence as base64", async () => {
    const { runner, calls } = fakeRunner();
    const result = await createKeyTool({ runner }).execute({ key: "ctrl+shift+tab" }, ctx);
    expect(result.content).toContain("Pressed key ctrl+shift+tab");
    const script = calls[0].script;
    expect(script).toContain("SendKeys");
    expect(script).toContain("SendWait");
    expect(embeddedValue(script)).toBe("^+{TAB}");
  });
});

describe("computer_scroll", () => {
  it("validates direction and amount", () => {
    const tool = createScrollTool({ runner: fakeRunner().runner });
    expect(() => tool.validateArgs!({})).toThrow(/direction/);
    expect(() => tool.validateArgs!({ direction: "left" })).toThrow(/direction/);
    expect(() => tool.validateArgs!({ direction: "down", amount: 0 })).toThrow(/amount/);
    expect(() => tool.validateArgs!({ direction: "down", amount: 11 })).toThrow(/amount/);
    expect(() => tool.validateArgs!({ direction: "down", amount: 2.5 })).toThrow(/amount/);
    expect(() => tool.validateArgs!({ direction: "down", amount: Number.NaN })).toThrow(/amount/);
    expect(() => tool.validateArgs!({ direction: "up" })).not.toThrow();
  });

  it("emits wheel deltas", async () => {
    const { runner, calls } = fakeRunner();
    const executing = createScrollTool({ runner });
    await executing.execute({ direction: "up" }, ctx);
    expect(calls[0].script).toContain("0x0800");
    expect(calls[0].script).toContain("360"); // 120 * 默认 3
    await executing.execute({ direction: "down", amount: 2 }, ctx);
    expect(calls[1].script).toContain("4294967056"); // -240 的无符号 32 位编码
  });
});

describe("input tool failure paths", () => {
  it("surfaces non-zero exits with the stderr tail and timeouts as errors", async () => {
    const failing = createScrollTool({ runner: fakeRunner({ exitCode: 1, stderr: "ps-failure" }).runner });
    await expect(failing.execute({ direction: "up" }, ctx)).rejects.toThrow("ps-failure");
    const timingOut = createScrollTool({ runner: fakeRunner({ exitCode: null, timedOut: true }).runner });
    await expect(timingOut.execute({ direction: "up" }, ctx)).rejects.toThrow(/timed out/i);
  });

  it("rejects non-Windows hosts before touching the runner", async () => {
    const { runner, calls } = fakeRunner();
    await expect(
      createTypeTool({ runner, platform: "linux" }).execute({ text: "hi" }, ctx),
    ).rejects.toThrow(/Windows hosts/);
    await expect(
      createClickTool({ runner, platform: "darwin" }).execute({ x: 1, y: 2 }, ctx),
    ).rejects.toThrow(/Windows hosts/);
    await expect(
      createKeyTool({ runner, platform: "linux" }).execute({ key: "enter" }, ctx),
    ).rejects.toThrow(/Windows hosts/);
    await expect(
      createScrollTool({ runner, platform: "darwin" }).execute({ direction: "up" }, ctx),
    ).rejects.toThrow(/Windows hosts/);
    expect(calls).toHaveLength(0);
  });

  it("forwards the run signal to the runner", async () => {
    const { runner, calls } = fakeRunner();
    await createTypeTool({ runner }).execute({ text: "ok" }, ctx);
    expect(calls[0].signal).toBe(ctx.signal);
  });
});
