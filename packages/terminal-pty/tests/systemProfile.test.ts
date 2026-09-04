import { describe, expect, it } from "vitest";
import {
  detectSystemTerminalFont,
  findGitBash,
  resolveCommandShell,
  resolveShellLaunch,
  resolveTerminalFont,
  stripJsonc,
} from "../src/systemProfile";

const win = "win32";
const env = {
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
  comspec: "C:\\Windows\\system32\\cmd.exe",
};

describe("findGitBash", () => {
  it("命中第一个存在的标准安装位置", () => {
    const fileExists = (p: string) => p === "C:\\Program Files\\Git\\bin\\bash.exe";
    expect(findGitBash({ env, fileExists })).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });
  it("全部缺失时返回 null", () => {
    expect(findGitBash({ env, fileExists: () => false })).toBeNull();
  });
});

describe("resolveShellLaunch (win32)", () => {
  it("auto 优先 Git Bash，找不到回退 comspec", () => {
    const withGit = resolveShellLaunch("auto", { platform: win, env, fileExists: () => true });
    expect(withGit.file).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
    expect(withGit.args).toEqual(["--login", "-i"]);
    const withoutGit = resolveShellLaunch("auto", { platform: win, env, fileExists: () => false });
    expect(withoutGit).toEqual({ file: env.comspec, args: [] });
  });
  it("显式 cmd / powershell / wsl 直达", () => {
    expect(resolveShellLaunch("cmd", { platform: win, env }).file).toBe(env.comspec);
    expect(resolveShellLaunch("powershell", { platform: win, env }).file).toBe("powershell.exe");
    expect(resolveShellLaunch("wsl", { platform: win, env }).file).toBe("wsl.exe");
  });
  it("显式 gitbash 找不到时回退 cmd", () => {
    expect(resolveShellLaunch("gitbash", { platform: win, env, fileExists: () => false }).file).toBe(env.comspec);
  });
  it("comspec 缺失时用 cmd.exe 字面量", () => {
    const launch = resolveShellLaunch("cmd", { platform: win, env: {} });
    expect(launch.file).toBe("cmd.exe");
  });
});

describe("resolveShellLaunch (posix)", () => {
  it("auto 使用 $SHELL，缺失回退 /bin/sh", () => {
    expect(resolveShellLaunch("auto", { platform: "darwin", env: { SHELL: "/bin/zsh" } }).file).toBe("/bin/zsh");
    expect(resolveShellLaunch("auto", { platform: "linux", env: {} }).file).toBe("/bin/sh");
  });
  it("Windows 专属选择在 posix 回落默认 shell", () => {
    expect(resolveShellLaunch("gitbash", { platform: "linux", env: { SHELL: "/bin/bash" } }).file).toBe("/bin/bash");
  });
});

describe("resolveCommandShell", () => {
  it("win32 auto 优先 Git Bash（--login -c），找不到回退 cmd /d /s /c", () => {
    const withGit = resolveCommandShell("auto", { platform: win, env, fileExists: () => true });
    expect(withGit).toEqual({ file: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["--login", "-c"] });
    const withoutGit = resolveCommandShell("auto", { platform: win, env, fileExists: () => false });
    expect(withoutGit).toEqual({ file: env.comspec, args: ["/d", "/s", "/c"] });
  });
  it("显式选择的命令标志正确", () => {
    expect(resolveCommandShell("powershell", { platform: win, env })).toEqual({
      file: "powershell.exe",
      args: ["-NoProfile", "-Command"],
    });
    expect(resolveCommandShell("wsl", { platform: win, env })).toEqual({
      file: "wsl.exe",
      args: ["-e", "bash", "-lc"],
    });
    expect(resolveCommandShell("cmd", { platform: win, env: {} })).toEqual({
      file: "cmd.exe",
      args: ["/d", "/s", "/c"],
    });
  });
  it("posix 恒 sh -c（$SHELL 优先）", () => {
    expect(resolveCommandShell("auto", { platform: "darwin", env: { SHELL: "/bin/zsh" } })).toEqual({
      file: "/bin/zsh",
      args: ["-c"],
    });
    expect(resolveCommandShell("gitbash", { platform: "linux", env: {} })).toEqual({
      file: "/bin/sh",
      args: ["-c"],
    });
  });
});

describe("stripJsonc", () => {
  it("去行注释、块注释与尾逗号，字符串内容原样保留", () => {
    const source = `{
      // default font
      "font": { "face": "Cascadia Mono", }, /* inline */
      "url": "http://example.com//keep",
      "escaped": "a\\" // not a comment",
    }`;
    const parsed = JSON.parse(stripJsonc(source));
    expect(parsed.font.face).toBe("Cascadia Mono");
    expect(parsed.url).toBe("http://example.com//keep");
    expect(parsed.escaped).toBe('a" // not a comment');
  });
});

describe("detectSystemTerminalFont", () => {
  const wtPath = `${env.LOCALAPPDATA}\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json`;
  it("读取 packaged Windows Terminal 的 profiles.defaults.font.face", () => {
    const probe = {
      platform: win,
      env,
      fileExists: (p: string) => p === wtPath,
      readFile: () => `{ "profiles": { "defaults": { "font": { "face": "Maple Mono NF" } } } }`,
    };
    expect(detectSystemTerminalFont(probe)).toBe("Maple Mono NF");
  });
  it("非 win32 / 无文件 / 配置损坏均返回 null", () => {
    expect(detectSystemTerminalFont({ platform: "darwin", env })).toBeNull();
    expect(detectSystemTerminalFont({ platform: win, env, fileExists: () => false })).toBeNull();
    expect(
      detectSystemTerminalFont({ platform: win, env, fileExists: () => true, readFile: () => "not json" }),
    ).toBeNull();
  });
});

describe("resolveTerminalFont", () => {
  it("显式覆盖优先，不去探测系统", () => {
    const font = resolveTerminalFont(
      { terminalFontFamily: "Sarasa Mono SC, monospace", terminalInheritProfile: true },
      { platform: win, env, fileExists: () => { throw new Error("should not probe"); } },
    );
    expect(font).toBe("Sarasa Mono SC, monospace");
  });
  it("继承关闭且无覆盖 → null", () => {
    expect(resolveTerminalFont({ terminalInheritProfile: false }, { platform: win, env })).toBeNull();
  });
  it("继承开启且无覆盖 → 探测系统终端字体，未安装 → null", () => {
    expect(resolveTerminalFont({}, { platform: win, env, fileExists: () => false })).toBeNull();
  });
});
