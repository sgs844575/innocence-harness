// 阻止系统空闲休眠（keepAwake 设置）：powerSaveBlocker 的幂等开关薄壳。
// 启动时与设置提交后各调一次（无条件幂等应用），关机经 disposeKeepAwake 释放。
import { powerSaveBlocker } from "electron";

let blockerId: number | undefined;

/** 开关实时生效；重复调用不产生第二个 blocker，关闭不存在的 blocker 是空操作。 */
export function applyKeepAwake(enabled: boolean): void {
  if (enabled) {
    blockerId ??= powerSaveBlocker.start("prevent-display-sleep");
    return;
  }
  if (blockerId !== undefined) {
    powerSaveBlocker.stop(blockerId);
    blockerId = undefined;
  }
}

/** 当前是否有存活的 blocker（测试与诊断面）。 */
export function isKeepAwakeActive(): boolean {
  return blockerId !== undefined;
}

/** 显式资源释放（关机路径）。 */
export function disposeKeepAwake(): void {
  applyKeepAwake(false);
}
