// computer_screenshot：截取整块虚拟屏幕，落两份产物——全分辨率 PNG（用户
// 留档路径）与 ≤1280 宽的 JPEG 降采样（模型可见图，控制 base64 体积）。
// 工具不落任何仓库路径，产物固定在系统临时目录 innocence-computer 子目录
// 下，由操作系统临时目录策略回收。模型可见图随 ToolResult.images 进入
// 视觉闭环；content 文案携带图像↔屏幕坐标的换算式（虚拟屏幕可能以负坐标
// 起始，多显示器同样成立）。
import fs from "node:fs";
import type { Tool, ToolContext } from "@innocenceharness/harness-tools";
import type { CommandRunner } from "./runner";
import { runPowerShellScript, screenshotScript } from "./internal/powershell";

/** 工具工厂注入面：runner 可替换为测试替身；platform 缺省取真实宿主。 */
export interface ComputerToolDeps {
  runner: CommandRunner;
  platform?: NodeJS.Platform;
}

/** 平台闸门的统一报错文案（英文，LLM 可见）。 */
export const PLATFORM_ERROR = "Computer control tools are only available on Windows hosts.";

/** 执行前平台检查：仅 win32 宿主可用。 */
export function assertWindowsHost(deps: ComputerToolDeps): void {
  if ((deps.platform ?? process.platform) !== "win32") {
    throw new Error(PLATFORM_ERROR);
  }
}

export interface CaptureOutput {
  pngPath: string;
  screen: { width: number; height: number; left: number; top: number };
  jpegPath: string;
  image: { width: number; height: number };
}

/** stdout 末行解析 `<png>|<W>x<H>|<jpg>|<jW>x<jH>|<bx>,<by>`
 * （竖线与逗号不是合法文件名字符）。 */
export function parseCaptureOutput(stdout: string): CaptureOutput {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .pop();
  const match = /^(.+)\|(\d+)x(\d+)\|(.+)\|(\d+)x(\d+)\|(-?\d+),(-?\d+)$/.exec(line ?? "");
  if (!match) {
    throw new Error("Screenshot failed: unexpected output from the capture process.");
  }
  return {
    pngPath: match[1],
    screen: { width: Number(match[2]), height: Number(match[3]), left: Number(match[7]), top: Number(match[8]) },
    jpegPath: match[4],
    image: { width: Number(match[5]), height: Number(match[6]) },
  };
}

/** 保留至多两位小数的比例文案（无尾随零：1.5、3、1.25）。 */
function formatScale(scale: number): string {
  if (Number.isInteger(scale)) return String(scale);
  return scale.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** 截图工具：只读（不改任何用户状态，产物是新增临时文件）。 */
export function createScreenshotTool(deps: ComputerToolDeps): Tool {
  return {
    name: "computer_screenshot",
    description:
      "Capture the whole virtual screen. Returns text with (a) the absolute path of a " +
      "full-resolution PNG archive and (b) the mapping between image pixels and screen " +
      "coordinates, and attaches a downscaled JPEG of the screen as the tool result " +
      "image so you can inspect it directly. Take a screenshot before click, type, key " +
      "or scroll actions to locate on-screen targets. Windows hosts only.",
    readOnly: true,
    sideEffect: "none",
    parameters: { type: "object" },
    permissionResource: () => ({ action: "read", kind: "computer", scope: "screen" }),
    persistArgs() {
      // 无参数工具：持久化面为空对象。
      return {};
    },
    async execute(_args, ctx: ToolContext) {
      assertWindowsHost(deps);
      const result = await runPowerShellScript(deps.runner, screenshotScript(), ctx.signal);
      const capture = parseCaptureOutput(result.stdout);
      const scale = formatScale(capture.screen.width / capture.image.width);
      const data = fs.readFileSync(capture.jpegPath).toString("base64");
      return {
        content: [
          `Screenshot archive: ${capture.pngPath} (${capture.screen.width}x${capture.screen.height}).`,
          `Returned image: ${capture.image.width}x${capture.image.height}.`,
          `Coordinates: screen_x = image_x * ${scale} + ${capture.screen.left}; screen_y = image_y * ${scale} + ${capture.screen.top}.`,
        ].join(" "),
        images: [{ mediaType: "image/jpeg", data }],
      };
    },
  };
}
