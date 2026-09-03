// computer_screenshot：截取整块虚拟屏幕，保存 PNG 临时文件并返回绝对路径
// 与分辨率。工具不落任何仓库路径，产物固定在系统临时目录 innocence-computer
// 子目录下，由操作系统临时目录策略回收。
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

/** stdout 末行解析 `<file>|<W>x<H>`（竖线不是 Windows 文件名的合法字符）。 */
function parseCaptureOutput(stdout: string): { file: string; width: string; height: string } {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .pop();
  const match = /^(.+)\|(\d+)x(\d+)$/.exec(line ?? "");
  if (!match) {
    throw new Error("Screenshot failed: unexpected output from the capture process.");
  }
  return { file: match[1], width: match[2], height: match[3] };
}

/** 截图工具：只读（不改任何用户状态，产物是新增临时文件）。 */
export function createScreenshotTool(deps: ComputerToolDeps): Tool {
  return {
    name: "computer_screenshot",
    description:
      "Capture the whole virtual screen and save it as a PNG file in the system temp " +
      "directory, then return the absolute file path together with the captured " +
      "resolution as '<path> (<width>x<height>)'. Take a screenshot before click, " +
      "type, key or scroll actions to locate on-screen targets. Windows hosts only.",
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
      const { file, width, height } = parseCaptureOutput(result.stdout);
      return { content: `${file} (${width}x${height})` };
    },
  };
}
