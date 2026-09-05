// 导入管线：大小校验 → 魔数嗅探 → 按类别解析（图像/文本/PDF/二进制引用）
// → 产出 ImportedAttachment（source + representations + preview + warnings）。
// 宿主（主进程）持有 FsContentStore 并调用 importAttachment。
import type { ContentRef } from "@innocenceharness/harness-session";
import {
  checkImportSize,
  type AttachmentParser,
  type ContentStore,
  type ImportedAttachment,
  type ParserInput,
} from "@innocenceharness/attachment-runtime";
import { sniffMedia } from "./sniff";
import { estimateImageTokens, normalizeImage } from "./images";
import { extractPdfText } from "./pdf";

/** 导入失败的结构化错误（宿主转用户可读提示）。 */
export class AttachmentImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentImportError";
  }
}

function textTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function storeBytes(store: ContentStore, bytes: Uint8Array, mediaType: string): Promise<ContentRef> {
  const stored = await store.put(bytes, mediaType);
  return { key: stored.key, mediaType, byteLength: stored.byteLength };
}

/** 图像解析：原始对象入 CAS；GIF/超尺寸派生 PNG 首表示；缩略图供预览。 */
const imageParser: AttachmentParser = {
  id: "image",
  version: "1",
  async parse(input: ParserInput, store: ContentStore): Promise<ImportedAttachment | null> {
    const sniffed = sniffMedia(input.bytes);
    if (sniffed.kind !== "image") return null;
    const source = await storeBytes(store, input.bytes, sniffed.mediaType);
    try {
      const normalized = await normalizeImage(input.bytes, { animated: sniffed.mediaType === "image/gif" });
      const warnings: string[] = [];
      if (sniffed.mediaType === "image/gif") warnings.push("GIF 动画按首帧静态图发送");
      const representationBytes = normalized.bytes ?? input.bytes;
      const representation = await storeBytes(
        store,
        representationBytes,
        normalized.bytes ? "image/png" : sniffed.mediaType,
      );
      const thumbnail = await storeBytes(store, normalized.thumbnail, "image/png");
      return {
        name: input.name,
        source: {
          ...source,
          estimatedTokens: estimateImageTokens(normalized.width, normalized.height),
        },
        representations: [{
          kind: "image",
          content: {
            ...representation,
            estimatedTokens: estimateImageTokens(normalized.width, normalized.height),
          },
        }],
        preview: {
          kind: "image",
          thumbnail,
          width: normalized.width,
          height: normalized.height,
        },
        warnings,
      };
    } catch {
      // 解码失败（损坏/非常规编码）：降级为二进制引用，导入不失败。
      return {
        name: input.name,
        source,
        representations: [],
        preview: { kind: "binary" },
        warnings: ["图像无法解码，仅作文件引用"],
      };
    }
  },
};

/** 文本解析：安全解码后整体作为文本表示（纯文本/代码/Markdown/JSON 同径）。 */
const textParser: AttachmentParser = {
  id: "text",
  version: "1",
  async parse(input: ParserInput, store: ContentStore): Promise<ImportedAttachment | null> {
    const sniffed = sniffMedia(input.bytes);
    if (sniffed.kind !== "text") return null;
    const { decodeText } = await import("./sniff");
    const text = decodeText(input.bytes);
    if (text === null) return null;
    const source = await storeBytes(store, input.bytes, "text/plain");
    const representation = await storeBytes(store, new TextEncoder().encode(text), "text/plain");
    return {
      name: input.name,
      source,
      representations: [{
        kind: "text",
        content: { ...representation, estimatedTokens: textTokens(text) },
      }],
      preview: { kind: "text", excerpt: text.slice(0, 200) },
      warnings: [],
    };
  },
};

/** PDF 解析：默认只发抽取文本；扫描件落警告 + 零表示（发送门控再拒）。 */
const pdfParser: AttachmentParser = {
  id: "pdf",
  version: "1",
  async parse(input: ParserInput, store: ContentStore): Promise<ImportedAttachment | null> {
    const sniffed = sniffMedia(input.bytes);
    if (sniffed.kind !== "pdf") return null;
    const source = await storeBytes(store, input.bytes, "application/pdf");
    const extract = await extractPdfText(input.bytes);
    const warnings: string[] = [];
    if (extract.scanned) warnings.push("扫描 PDF：无可抽取文本，未选择页面时无法提供内容");
    const representations: ImportedAttachment["representations"] = [];
    let preview: ImportedAttachment["preview"] = { kind: "binary" };
    if (!extract.scanned) {
      const textRef = await storeBytes(
        store,
        new TextEncoder().encode(extract.text),
        "text/plain",
      );
      representations.push({
        kind: "text",
        content: { ...textRef, estimatedTokens: textTokens(extract.text) },
      });
      preview = { kind: "text", excerpt: extract.text.slice(0, 200) };
    }
    return { name: input.name, source, representations, preview, warnings };
  },
};

/** 兜底：非目标类型（Office/音视频/压缩包等）仅作项目文件引用。 */
const binaryParser: AttachmentParser = {
  id: "binary",
  version: "1",
  async parse(input: ParserInput, store: ContentStore): Promise<ImportedAttachment | null> {
    const sniffed = sniffMedia(input.bytes);
    const source = await storeBytes(store, input.bytes, sniffed.mediaType);
    return {
      name: input.name,
      source,
      representations: [],
      preview: { kind: "binary" },
      warnings: ["该类型不解析，仅作文件引用"],
    };
  },
};

/** 解析器序：图像 → PDF → 文本 → 二进制兜底（互斥嗅探，序仅防御）。 */
export const PARSERS: readonly AttachmentParser[] = [imageParser, pdfParser, textParser, binaryParser];

/** 导入一个附件（字节 + 展示名）：大小前置校验，绝不静默截断。 */
export async function importAttachment(
  store: ContentStore,
  input: { name: string; bytes: Uint8Array },
): Promise<ImportedAttachment> {
  const limit = checkImportSize(input.name, input.bytes.byteLength);
  if (limit) {
    throw new AttachmentImportError(
      limit.kind === "too-large"
        ? `附件 ${input.name} 超过 25 MiB 上限`
        : `附件数量超限`,
    );
  }
  for (const parser of PARSERS) {
    const parsed = await parser.parse({ name: input.name, bytes: input.bytes }, store);
    if (parsed) return parsed;
  }
  // binaryParser 恒命中 —— 不可达防御。
  throw new AttachmentImportError(`附件 ${input.name} 无法导入`);
}
