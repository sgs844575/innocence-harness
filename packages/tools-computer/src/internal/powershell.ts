// PowerShell 脚本装配：全部脚本片段集中在此。字符串入参一律 base64 编码
// 嵌入、脚本内经 [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(
// '...')) 解码，规避多层引号转义；数字入参必须先经 TS 侧校验（有限整数、
// 显式边界）后才允许拼进脚本。每段脚本以 $ErrorActionPreference='Stop' 开头，
// 任何终止性错误都会以非零码结束进程，由 runPowerShellScript 收敛为 Error。
import { Buffer } from "node:buffer";
import type { CommandRunner, ProcessRunResult } from "../runner";

const PS_PREAMBLE = "$ErrorActionPreference = 'Stop'";

/** user32 鼠标入口：SetCursorPos + mouse_event。 */
const MOUSE_NATIVE_CS = `using System;
using System.Runtime.InteropServices;
public static class MouseNative {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}`;

/**
 * SendInput 键盘入口：逐字符 KEYEVENTF_UNICODE 下/上事件注入，换行符
 * 转为 VK_RETURN 敲击（输入法无关的文本注入路径）。
 */
const KEYBOARD_NATIVE_CS = `using System;
using System.Runtime.InteropServices;
public static class KeyboardNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const ushort VK_RETURN = 0x0D;
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    public static void TypeText(string text) {
        foreach (char c in text) {
            if (c == '\\n') { Tap(VK_RETURN); continue; }
            SendUnicode(c, KEYEVENTF_UNICODE);
            SendUnicode(c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
        }
    }
    static void SendUnicode(char c, uint flags) {
        var input = new INPUT { type = 1 };
        input.U.ki.wScan = c;
        input.U.ki.dwFlags = flags;
        SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
    }
    static void Tap(ushort vk) {
        var down = new INPUT { type = 1 };
        down.U.ki.wVk = vk;
        SendInput(1, new INPUT[] { down }, Marshal.SizeOf(typeof(INPUT)));
        var up = new INPUT { type = 1 };
        up.U.ki.wVk = vk;
        up.U.ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(1, new INPUT[] { up }, Marshal.SizeOf(typeof(INPUT)));
    }
}`;

/** UTF-8 字符串 → base64（脚本嵌入的唯一字符串通道）。 */
export function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** 脚本内 base64 字符串解码表达式（入参必须是 toBase64 的产物）。 */
function decodeExpr(base64: string): string {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}'))`;
}

/** 截图：整块虚拟屏幕 → PNG 临时文件，stdout 输出 `<file>|<W>x<H>`。 */
export function screenshotScript(): string {
  return [
    PS_PREAMBLE,
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)",
    "$directory = Join-Path $env:TEMP 'innocence-computer'",
    "New-Item -ItemType Directory -Force -Path $directory | Out-Null",
    "$name = 'screen-{0}-{1}.png' -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), [Guid]::NewGuid().ToString('N').Substring(0, 8)",
    "$path = Join-Path $directory $name",
    "$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)",
    "$graphics.Dispose()",
    "$bitmap.Dispose()",
    "Write-Output ('{0}|{1}x{2}' -f $path, $bounds.Width, $bounds.Height)",
  ].join("\n");
}

/** mouse_event 按下/抬起标志对（left 0x02/0x04，right 0x08/0x10，middle 0x20/0x40）。 */
const BUTTON_FLAGS: Record<"left" | "right" | "middle", [string, string]> = {
  left: ["0x02", "0x04"],
  right: ["0x08", "0x10"],
  middle: ["0x20", "0x40"],
};

/** 点击时序：落位停顿、按下/抬起间隔、双击间隙（毫秒）。 */
const SETTLE_MS = 60;
const PRESS_MS = 40;
const DOUBLE_CLICK_GAP_MS = 120;

/** 点击：移动光标后按下并抬起一次；双击再连点一次（间隙 ~120ms）。 */
export function clickScript(
  x: number,
  y: number,
  button: "left" | "right" | "middle",
  double: boolean,
): string {
  const [down, up] = BUTTON_FLAGS[button];
  const press = [
    `[MouseNative]::mouse_event(${down}, 0, 0, 0, [UIntPtr]::Zero)`,
    `Start-Sleep -Milliseconds ${PRESS_MS}`,
    `[MouseNative]::mouse_event(${up}, 0, 0, 0, [UIntPtr]::Zero)`,
  ];
  return [
    PS_PREAMBLE,
    "Add-Type @'",
    MOUSE_NATIVE_CS,
    "'@",
    `if (-not [MouseNative]::SetCursorPos(${x}, ${y})) { throw 'SetCursorPos failed' }`,
    `Start-Sleep -Milliseconds ${SETTLE_MS}`,
    ...press,
    ...(double ? [`Start-Sleep -Milliseconds ${DOUBLE_CLICK_GAP_MS}`, ...press] : []),
    "Write-Output 'ok'",
  ].join("\n");
}

/** 键入：SendInput 逐字符 Unicode 注入，文本经 base64 嵌入。 */
export function typeTextScript(text: string): string {
  return [
    PS_PREAMBLE,
    "Add-Type @'",
    KEYBOARD_NATIVE_CS,
    "'@",
    `[KeyboardNative]::TypeText(${decodeExpr(toBase64(text))})`,
    "Write-Output 'ok'",
  ].join("\n");
}

/** 按键：TS 侧已映射好的 SendKeys 序列经 base64 嵌入后 SendWait。 */
export function keyScript(sequence: string): string {
  return [
    PS_PREAMBLE,
    "Add-Type -AssemblyName System.Windows.Forms",
    `[System.Windows.Forms.SendKeys]::SendWait(${decodeExpr(toBase64(sequence))})`,
    "Write-Output 'ok'",
  ].join("\n");
}

/** 滚轮：mouse_event 0x0800，dwData 为 ±120*amount 的无符号 32 位编码。 */
export function scrollScript(direction: "up" | "down", amount: number): string {
  const delta = (direction === "up" ? 120 : -120) * amount;
  const encoded = delta >>> 0;
  return [
    PS_PREAMBLE,
    "Add-Type @'",
    MOUSE_NATIVE_CS,
    "'@",
    `[MouseNative]::mouse_event(0x0800, 0, 0, ${encoded}, [UIntPtr]::Zero)`,
    "Write-Output 'ok'",
  ].join("\n");
}

const STDERR_TAIL_CHARS = 400;

/** stderr 尾部回显：带上限的诊断，不无限回吐。 */
function stderrTail(stderr: string): string {
  const text = stderr.trim();
  if (text === "") return "";
  const tail = text.length > STDERR_TAIL_CHARS ? text.slice(-STDERR_TAIL_CHARS) : text;
  return ` Error output: ${tail}`;
}

/**
 * 运行脚本并把失败收敛为带 stderr 尾部的英文 Error（非零退出/超时）；
 * 成功时原样返回结果供调用方解析 stdout。
 */
export async function runPowerShellScript(
  runner: CommandRunner,
  script: string,
  signal?: AbortSignal,
): Promise<ProcessRunResult> {
  const result = await runner({ script, signal });
  if (result.timedOut) {
    throw new Error(`Computer control command timed out.${stderrTail(result.stderr)}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Computer control command failed with exit code ${result.exitCode}.${stderrTail(result.stderr)}`,
    );
  }
  return result;
}
