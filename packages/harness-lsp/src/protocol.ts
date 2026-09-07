// LSP 基础协议件（语言服务器波）：JSON-RPC 消息形状与 Content-Length 分帧。
// LSP 以 ASCII 头（Content-Length: N\r\n，头段以空行 \r\n 结束）+ UTF-8
// JSON 体组成一条消息；与 MCP 的换行分帧不同，这里是显式字节长度前缀。
// 分帧器为纯函数式累积器：喂入任意切分的字节块，弹出完整消息。

/** 一条 LSP/JSON-RPC 消息（请求/通知/响应的并集形状）。 */
export interface LspMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const HEADER_TERMINATOR = "\r\n\r\n";
const CONTENT_LENGTH_HEADER = /content-length\s*:\s*(\d+)/i;

/** 编码一条消息为 LSP 帧（头 + 空行 + UTF-8 JSON 体）。 */
export function encodeLspMessage(message: LspMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(
    `Content-Length: ${body.byteLength}${HEADER_TERMINATOR}`,
    "ascii",
  );
  return Buffer.concat([header, body]);
}

/**
 * 增量分帧器：feed() 喂入字节块，返回本次弹出的完整消息。半条消息留
 * 在内部缓冲等待后续块；畸形头（非数字长度/超界）抛错——调用方按传输
 * 损坏处理（杀连接），永不静默吞。
 */
export class LspFrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  /** 单条消息体长度上限（32MB）：远超任何合法诊断/补全载荷，防御失控服务器。 */
  static readonly MAX_BODY_BYTES = 32 * 1024 * 1024;

  feed(chunk: Buffer | string): LspMessage[] {
    this.buffer = typeof chunk === "string"
      ? Buffer.concat([this.buffer, Buffer.from(chunk, "utf8")])
      : Buffer.concat([this.buffer, chunk]);
    const messages: LspMessage[] = [];
    for (let message = this.tryPop(); message !== undefined; message = this.tryPop()) {
      messages.push(message);
    }
    return messages;
  }

  private tryPop(): LspMessage | undefined {
    const headerEnd = this.buffer.indexOf(HEADER_TERMINATOR, 0, "ascii");
    if (headerEnd < 0) {
      if (this.buffer.byteLength > 64 * 1024) {
        throw new Error("LSP header exceeds 64KB without a terminator");
      }
      return undefined;
    }
    const header = this.buffer.subarray(0, headerEnd).toString("ascii");
    const match = CONTENT_LENGTH_HEADER.exec(header);
    if (match === null) {
      throw new Error(`LSP header is missing Content-Length: ${header.slice(0, 120)}`);
    }
    const bodyLength = Number(match[1]);
    if (!Number.isInteger(bodyLength) || bodyLength < 0 || bodyLength > LspFrameDecoder.MAX_BODY_BYTES) {
      throw new Error(`LSP Content-Length is out of range: ${bodyLength}`);
    }
    const bodyStart = headerEnd + HEADER_TERMINATOR.length;
    if (this.buffer.byteLength < bodyStart + bodyLength) return undefined;
    const body = this.buffer.subarray(bodyStart, bodyStart + bodyLength).toString("utf8");
    this.buffer = this.buffer.subarray(bodyStart + bodyLength);
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("LSP body is not a JSON object");
    }
    return parsed as LspMessage;
  }
}
