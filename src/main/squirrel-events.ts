// Squirrel.Windows 安装事件（仅 Windows 打包分发路径出现）：
// Setup.exe/Update.exe 在安装、更新、卸载时会以 --squirrel-* 参数启动应用，
// 期望应用完成对应动作后立即退出。快捷方式按 Squirrel 约定由应用经
// Update.exe 的 --createShortcut/--removeShortcut 代建（开始菜单与桌面），
// Squirrel 自身不创建——未处理这些事件时快捷方式永远不会出现，安装/卸载
// 还会把应用完整拉起、拖住安装器。本模块保持 electron-free：命令构造与
// 事件识别均为纯函数，拉起进程与退出由主入口执行。
import path from "node:path";

export type SquirrelEvent = "install" | "updated" | "uninstall" | "obsolete";

/**
 * 从命令行识别 Squirrel 事件。dev 与正常启动返回 null；
 * `--squirrel-firstrun` 属安装完成后的正常首跑，同样返回 null（不退出）。
 */
export function squirrelEventFromArgv(argv: readonly string[]): SquirrelEvent | null {
  switch (argv[1] ?? "") {
    case "--squirrel-install":
      return "install";
    case "--squirrel-updated":
      return "updated";
    case "--squirrel-uninstall":
      return "uninstall";
    case "--squirrel-obsolete":
      return "obsolete";
    default:
      return null;
  }
}

/** Update.exe 位于 app-<version>/ 子目录的上一级（安装根）。 */
export function updateExeFor(execPath: string): string {
  return path.resolve(path.dirname(execPath), "..", "Update.exe");
}

/**
 * 事件对应的 Update.exe 代建命令：安装/更新建快捷方式、卸载移除；
 * obsolete（旧版本目录清理前的启动）无动作，仅由调用方退出。
 */
export function squirrelShortcutAction(
  event: SquirrelEvent,
  execPath: string,
): { exe: string; args: string[] } | null {
  if (event === "obsolete") return null;
  const verb = event === "uninstall" ? "--removeShortcut" : "--createShortcut";
  return { exe: updateExeFor(execPath), args: [verb, path.basename(execPath)] };
}
