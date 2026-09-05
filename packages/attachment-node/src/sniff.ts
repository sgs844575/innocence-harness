// 魔数嗅探（规格 §12：MIME 欺骗检测——以魔数为准，扩展名仅辅助显示）与
// 文本安全解码（BOM/UTF-8 检测；含 NUL 或无法安全解码 = 二进制引用）。
export type SniffKind = "image" | "pdf" | "text" | "binary";

export interface SniffResult {
  kind: SniffKind;
  mediaType: string;
}

/** 头部嗅探窗口：魔数都在前 16 字节内。 */
const SNIFF_BYTES = 16;

export function sniffMedia(bytes: Uint8Array): SniffResult {
  const head = bytes.subarray(0, Math.min(bytes.byteLength, SNIFF_BYTES));
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { kind: "image", mediaType: "image/png" };
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: "image", mediaType: "image/jpeg" };
  }
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return { kind: "image", mediaType: "image/webp" };
  }
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
    return { kind: "image", mediaType: "image/gif" };
  }
  const latin = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 1024))).toString("latin1");
  if (latin.includes("%PDF-")) {
    return { kind: "pdf", mediaType: "application/pdf" };
  }
  if (decodeText(bytes) !== null) {
    return { kind: "text", mediaType: "text/plain" };
  }
  return { kind: "binary", mediaType: "application/octet-stream" };
}

/**
 * 安全文本解码：BOM（UTF-8 / UTF-16LE / UTF-16BE）优先——UTF-16 的高位零
 * 字节是合法载荷，NUL 判定在解码后的文本上做；无 BOM 走原始 NUL 探测 +
 * 严格 UTF-8。无法安全解码返回 null（调用方按二进制引用处理，规格 §2）。
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return "";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeWithoutNul("utf-8", bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeWithoutNul("utf-16le", bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeWithoutNul("utf-16be", bytes.subarray(2));
  }
  const probe = bytes.subarray(0, Math.min(bytes.byteLength, 8000));
  if (probe.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeWithoutNul(encoding: string, bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder(encoding).decode(bytes);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}
