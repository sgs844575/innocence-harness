// computer 插件：Windows 宿主桌面操控工具（截图/点击/键入/按键/滚动）。
// 仅通过 PowerShell 驱动系统输入与屏幕捕获，不依赖任何宿主框架。非
// Windows 宿主上 apply 直接返回，不注册任何工具；工厂侧另有平台闸门
// （assertWindowsHost）兜底直接装配工厂的宿主。
import type { Context } from "@innocenceharness/kernel";
import { createClickTool, createKeyTool, createScrollTool, createTypeTool } from "./input";
import { createPowershellRunner } from "./runner";
import { createScreenshotTool } from "./screen";

/** staging id "computer"。platform 参数供测试与嵌入式宿主注入。 */
export const ComputerPlugin = {
  name: "computer" as const,
  async apply(ctx: Context, platform: NodeJS.Platform = process.platform) {
    if (platform !== "win32") return;
    const runner = createPowershellRunner();
    ctx.tools.register(createScreenshotTool({ runner, platform }));
    ctx.tools.register(createClickTool({ runner, platform }));
    ctx.tools.register(createTypeTool({ runner, platform }));
    ctx.tools.register(createKeyTool({ runner, platform }));
    ctx.tools.register(createScrollTool({ runner, platform }));
  },
};
export default ComputerPlugin;

export { createClickTool, createKeyTool, createScrollTool, createTypeTool } from "./input";
export { assertWindowsHost, createScreenshotTool, PLATFORM_ERROR, type ComputerToolDeps } from "./screen";
export {
  createPowershellRunner,
  type CommandRunner,
  type CommandRunnerOptions,
  type ProcessRunResult,
} from "./runner";
export { toSendKeysSequence } from "./internal/keys";
