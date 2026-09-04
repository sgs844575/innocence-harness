// 系统终端 Profile 探测与 shell 解析（纯 Node、无 Electron）：终端字体覆盖/
// 继承与集成终端 shell 选择（Windows 下 Bash 工具同用）共享这一份实现。
// 所有系统接触点（env / existsSync / readFile）都可注入，保持单测可移植。
import { existsSync, readFileSync } from "node:fs";

/** 集成终端 shell 选择（镜像 settings.terminalShell；本包不依赖 harness-electron）。 */
export type TerminalShellChoice = "auto" | "cmd" | "powershell" | "gitbash" | "wsl";

export interface ShellLaunch {
  file: string;
  args: string[];
}

/** 探测注入点：缺省用真实文件系统与进程环境。 */
export interface SystemProbe {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
}

function gitBashCandidates(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const programFiles = env["ProgramFiles"];
  const programFilesX86 = env["ProgramFiles(x86)"];
  const localAppData = env["LOCALAPPDATA"];
  if (programFiles) out.push(`${programFiles}\\Git\\bin\\bash.exe`);
  if (programFilesX86) out.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
  if (localAppData) out.push(`${localAppData}\\Programs\\Git\\bin\\bash.exe`);
  return out;
}

/** Git Bash 探测：标准安装位置依次命中；找不到返回 null（调用方回退）。 */
export function findGitBash(probe: SystemProbe = {}): string | null {
  const env = probe.env ?? process.env;
  const exists = probe.fileExists ?? existsSync;
  for (const candidate of gitBashCandidates(env)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * 解析集成终端 shell 启动命令。Windows：auto 优先 Git Bash、找不到回退
 * comspec/cmd.exe；显式选择找不到时同样回退 cmd。POSIX：仅 auto 有意义
 * （$SHELL || /bin/sh）；Windows 专属选择在其他平台回落默认 shell。
 */
export function resolveShellLaunch(choice: TerminalShellChoice, probe: SystemProbe = {}): ShellLaunch {
  const platform = probe.platform ?? process.platform;
  const env = probe.env ?? process.env;
  if (platform === "win32") {
    const cmd: ShellLaunch = { file: env.comspec || "cmd.exe", args: [] };
    switch (choice) {
      case "cmd":
        return cmd;
      case "powershell":
        return { file: "powershell.exe", args: [] };
      case "wsl":
        return { file: "wsl.exe", args: [] };
      case "gitbash":
        return probeGitBashOr(probe, cmd);
      case "auto":
        return probeGitBashOr(probe, cmd);
    }
  }
  return { file: env.SHELL || "/bin/sh", args: [] };
}

function probeGitBashOr(probe: SystemProbe, fallback: ShellLaunch): ShellLaunch {
  const found = findGitBash(probe);
  return found ? { file: found, args: ["--login", "-i"] } : fallback;
}

/**
 * 非交互命令执行模板（Bash 工具用）：spawn(file, [...args, command])，args
 * 已含各 shell 的命令行标志。win32 auto 优先 Git Bash（--login -c），回退
 * comspec /d /s /c（等同 Node shell:true 的内部展开）；POSIX 恒 sh -c。
 */
export function resolveCommandShell(choice: TerminalShellChoice, probe: SystemProbe = {}): ShellLaunch {
  const platform = probe.platform ?? process.platform;
  const env = probe.env ?? process.env;
  if (platform === "win32") {
    const cmd: ShellLaunch = { file: env.comspec || "cmd.exe", args: ["/d", "/s", "/c"] };
    switch (choice) {
      case "cmd":
        return cmd;
      case "powershell":
        return { file: "powershell.exe", args: ["-NoProfile", "-Command"] };
      case "wsl":
        return { file: "wsl.exe", args: ["-e", "bash", "-lc"] };
      case "gitbash":
      case "auto": {
        const found = findGitBash(probe);
        return found ? { file: found, args: ["--login", "-c"] } : cmd;
      }
    }
  }
  return { file: env.SHELL || "/bin/sh", args: ["-c"] };
}

/** 去除 JSONC 注释与尾逗号（Windows Terminal settings.json 允许两者）；
 *  状态机跳过字符串字面量，字符串内的 // 与 /* 不受影响。 */
export function stripJsonc(source: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  // 尾逗号：对象/数组闭合前的逗号删掉（字符串已在上面转义输出，安全）。
  return out.replace(/,(\s*[}\]])/g, "$1");
}

interface WindowsTerminalSettings {
  profiles?: {
    defaults?: { font?: { face?: unknown } };
  };
}

/** Windows Terminal 默认 Profile 字体探测（仅 win32；未安装/无配置 → null）。 */
export function detectSystemTerminalFont(probe: SystemProbe = {}): string | null {
  const platform = probe.platform ?? process.platform;
  if (platform !== "win32") return null;
  const env = probe.env ?? process.env;
  const exists = probe.fileExists ?? existsSync;
  const read = probe.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const localAppData = env["LOCALAPPDATA"];
  if (!localAppData) return null;
  const candidates = [
    `${localAppData}\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json`,
    `${localAppData}\\Microsoft\\Windows Terminal\\settings.json`,
  ];
  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    try {
      const parsed = JSON.parse(stripJsonc(read(candidate))) as WindowsTerminalSettings;
      const face = parsed.profiles?.defaults?.font?.face;
      if (typeof face === "string" && face.trim() !== "") return face;
    } catch {
      // 配置损坏时静默回落等宽默认。
    }
  }
  return null;
}

/** 终端生效字体：显式覆盖优先；否则继承开关开启时探测系统终端字体；都没有 → null（等宽默认）。 */
export function resolveTerminalFont(
  settings: { terminalFontFamily?: string; terminalInheritProfile?: boolean },
  probe: SystemProbe = {},
): string | null {
  const override = settings.terminalFontFamily?.trim();
  if (override) return override;
  if (settings.terminalInheritProfile === false) return null;
  return detectSystemTerminalFont(probe);
}
