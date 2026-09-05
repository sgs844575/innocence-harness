// computer 插件：Windows 宿主桌面操控工具（截图/点击/键入/按键/滚动）。
// 仅通过 PowerShell 驱动系统输入与屏幕捕获，不依赖任何宿主框架。非
// Windows 宿主上 apply 直接返回，不注册任何工具；工厂侧另有平台闸门
// （assertWindowsHost）兜底直接装配工厂的宿主。
import type { Context } from "@innocenceharness/kernel";
import { observeToolActivity, type ToolActivityObserver } from "@innocenceharness/harness-tools";
import { createClickTool, createKeyTool, createScrollTool, createTypeTool } from "./input";
import { createPowershellRunner } from "./runner";
import { createScreenshotTool } from "./screen";
import { computerControlSkill } from "./skill";

export interface ComputerPluginOptions {
  platform?: NodeJS.Platform;
  /** Read for every call so disabling access also gates already built sessions. */
  isEnabled?: () => boolean;
  activity?: ToolActivityObserver;
}

/** staging id "computer"。platform 参数供测试与嵌入式宿主注入。 */
export const ComputerPlugin = {
  name: "computer" as const,
  async apply(ctx: Context, options: ComputerPluginOptions | NodeJS.Platform = {}) {
    const { platform = process.platform, isEnabled = () => true, activity } = typeof options === "string" ? { platform: options } : options;
    if (platform !== "win32") return;
    if (!isEnabled()) return;
    const runner = createPowershellRunner();
    for (const create of [createScreenshotTool, createClickTool, createTypeTool, createKeyTool, createScrollTool]) {
      const tool = create({ runner, platform });
      ctx.tools.register({
        ...tool,
        execute: (args, context) => isEnabled()
          ? observeToolActivity(activity, tool.name, context, () => tool.execute(args, context))
          : Promise.resolve({ content: "Computer control is disabled in Settings.", isError: true }),
      });
    }
    if (ctx.skills && !ctx.skills.get(computerControlSkill.name)) {
      ctx.skills.register({
        ...computerControlSkill,
        loadBody: async () => {
          if (!isEnabled()) throw new Error("Computer control is disabled in Settings.");
          return computerControlSkill.loadBody();
        },
      });
    }
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
