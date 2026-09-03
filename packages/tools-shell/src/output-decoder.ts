// Windows 控制台程序的字节输出跟随系统代码页（中文系统 cmd 的本地化文本是
// GBK/936），一律按 UTF-8 解码会得到乱码。这里按内容自动选择编码：纯 ASCII
// 前缀在两种编码下等价，直接透传；遇到非 ASCII 字节时按 UTF-8 合法性判定——
// 合法走 UTF-8，否则回退 chcp 报告的系统代码页。判定以流为粒度，一次定终身。
import { isUtf8 } from "node:buffer";
import { execFile } from "node:child_process";

/** 增量输出解码器。 */
export interface OutputDecoder {
  /** 喂入一个原始数据块，返回可立即展示的文本（不完整多字节序列会暂存）。 */
  push(chunk: Buffer): string;
  /** 流结束，冲刷解码器内部暂存。 */
  end(): string;
}

let ansiEncodingPromise: Promise<string | null> | undefined;

/**
 * Windows ANSI 代码页对应的 WHATWG 编码标签（65001=UTF-8 或查询失败 → null，
 * 维持纯 UTF-8 解码）。chcp 输出与区域无关地含数字代码页，查一次并缓存。
 */
export function windowsAnsiEncoding(): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  ansiEncodingPromise ??= new Promise((resolve) => {
    execFile("chcp.com", { windowsHide: true, timeout: 5_000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const match = /(\d+)/.exec(stdout);
      const label = match ? ansiEncodingLabel(Number(match[1])) : null;
      if (!label) {
        resolve(null);
        return;
      }
      try {
        new TextDecoder(label);
        resolve(label);
      } catch {
        resolve(null);
      }
    });
  });
  return ansiEncodingPromise;
}

function ansiEncodingLabel(code: number): string | null {
  switch (code) {
    case 936:
    case 54936:
      return "gbk";
    case 950:
      return "big5";
    case 932:
      return "shift_jis";
    case 949:
      return "euc-kr";
    case 866:
      return "ibm866";
    case 874:
      return "windows-874";
    default:
      // 1200/1201（UTF-16）与 65001（UTF-8）不需要回退；其余 Latin 单字节页
      // 落在 windows-125x，不认识的代码页不做回退。
      if (code >= 1250 && code <= 1258) return `windows-${code}`;
      return null;
  }
}

/**
 * 判断一段（可能以不完整多字节序列结尾的）字节是否按 UTF-8 解读：
 * 尾部回看至多 3 个 continuation 字节定位序列头，头字节声明的总长超出缓冲
 * 即视为不完整，校验时排除这段。
 */
function assessUtf8(bytes: Buffer): { valid: boolean; complete: boolean } {
  let leadIndex = -1;
  for (let scanned = 0; scanned < 4; scanned++) {
    const i = bytes.length - 1 - scanned;
    if (i < 0) break;
    if ((bytes[i] & 0xc0) !== 0x80) {
      leadIndex = i;
      break;
    }
  }
  let end = bytes.length;
  let complete = true;
  if (leadIndex >= 0 && bytes[leadIndex] >= 0xc2) {
    const sequenceLength = bytes[leadIndex] >= 0xf0 ? 4 : bytes[leadIndex] >= 0xe0 ? 3 : 2;
    if (bytes.length - leadIndex < sequenceLength) {
      end = leadIndex;
      complete = false;
    }
  }
  return { valid: isUtf8(bytes.subarray(0, end)), complete };
}

/**
 * 创建一个流的增量解码器。`ansiEncoding` 为 null 时（非 Windows / UTF-8 控制
 * 台 / 代码页查询失败）固定 UTF-8，行为与旧的 toString("utf8") 一致，另修复
 * 跨块切分多字节字符产生的替换符。内容判定的固有盲区：整个流只有极个别
 * GBK 双字节恰好构成合法 UTF-8 序列时可能误判为 UTF-8——真实输出（整段本
 * 地化文本）会迅速出现非法 UTF-8 字节而正确落入代码页通道。
 */
export function createOutputDecoder(ansiEncoding: string | null): OutputDecoder {
  const utf8 = new TextDecoder("utf-8");
  const ansi = ansiEncoding === null ? null : new TextDecoder(ansiEncoding);
  let mode: "pending" | "utf8" | "ansi" = ansi === null ? "utf8" : "pending";
  let pending: Buffer = Buffer.alloc(0);

  return {
    push(chunk) {
      if (mode === "utf8") return utf8.decode(chunk, { stream: true });
      // mode 为 "ansi" 时 ansi 必非空（仅在该分支设置）。
      if (mode === "ansi") return ansi!.decode(chunk, { stream: true });
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let firstMultibyte = -1;
      for (let i = 0; i < pending.length; i++) {
        if (pending[i] >= 0x80) {
          firstMultibyte = i;
          break;
        }
      }
      if (firstMultibyte === -1) {
        const asciiOnly = pending.toString("latin1");
        pending = Buffer.alloc(0);
        return asciiOnly;
      }
      const ascii = pending.subarray(0, firstMultibyte).toString("latin1");
      const rest = pending.subarray(firstMultibyte);
      const assessment = assessUtf8(rest);
      if (!assessment.valid) {
        mode = "ansi";
        pending = Buffer.alloc(0);
        return ascii + ansi!.decode(rest, { stream: true });
      }
      if (assessment.complete) {
        mode = "utf8";
        pending = Buffer.alloc(0);
        return ascii + utf8.decode(rest, { stream: true });
      }
      // 尾部可能是不完整序列：暂存，与下一个数据块合并后再判定。
      pending = Buffer.from(rest);
      return ascii;
    },
    end() {
      if (mode === "ansi") return ansi!.decode();
      if (mode === "utf8") return utf8.decode();
      if (pending.length === 0) return "";
      // 流结束仍未定夺：按最终缓冲的 UTF-8 合法性收尾。
      const rest = pending;
      pending = Buffer.alloc(0);
      return isUtf8(rest) || ansi === null ? utf8.decode(rest) : ansi.decode(rest);
    },
  };
}
