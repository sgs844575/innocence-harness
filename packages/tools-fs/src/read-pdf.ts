// PDF 读取面（S4-PDF）：基于已装 pdfjs-dist 的页数探测与按页文本抽取。
// 动态导入 + 失败即退回"二进制文件"注记——无 PDF 依赖面时 Read 其余路径
// 零影响。纯 Node 面（Electron-free），vitest 直测。
import type { ReadFileSignature } from "./read-state";

export interface PdfPageRead {
  /** 文本正文（无行号：PDF 文本非行结构）。 */
  text: string;
  pageNumber: number;
  pageCount: number;
}

/** %PDF 魔数探测（前 5 字节，兼容 BOM 前缀宽容到首 1KB 内命中）。 */
export async function isPdfFile(target: string): Promise<boolean> {
  const { open } = await import("node:fs/promises");
  const handle = await open(target, "r");
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, 1024, 0);
    const head = buffer.subarray(0, bytesRead).toString("latin1");
    return head.includes("%PDF-");
  } finally {
    await handle.close();
  }
}

async function loadPdfDocument(target: string) {
  const fs = await import("node:fs/promises");
  const data = new Uint8Array(await fs.readFile(target));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data, useSystemFonts: false }).promise;
}

/** 页数探测 + 分页指引（不抽正文）。大文档/损坏文档的入口行为。 */
export async function probePdf(target: string): Promise<{ pageCount: number }> {
  const doc = await loadPdfDocument(target);
  const pageCount = doc.numPages;
  await doc.destroy();
  return { pageCount };
}

/** 按页抽取文本（1 起；越界抛错由调用方转为注记）。 */
export async function readPdfPage(target: string, pageNumber: number): Promise<PdfPageRead> {
  const doc = await loadPdfDocument(target);
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new Error(`PDF 页码越界：共 ${doc.numPages} 页，page=${pageNumber} 无效`);
    }
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    return { text, pageNumber, pageCount: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

/** PDF 读取的 Read 结果装配：探测/分页共用（中文注记口径同 Read 既有注记）。 */
export function renderPdfResult(
  outcome: { pageCount: number; pageNumber?: number; text?: string },
  signature: ReadFileSignature,
): { content: string } {
  const { pageCount, pageNumber, text } = outcome;
  if (pageNumber === undefined) {
    return {
      content:
        `[PDF 文档：共 ${pageCount} 页（${formatBytes(signature.size)}）。` +
        "按页读取文本：加 page 参数（1 起，一次一页）；本响应只含元数据]",
    };
  }
  const body = text && text.length > 0 ? text : "（本页无可抽取文本——扫描图/纯图形页）";
  return {
    content:
      `[PDF 第 ${pageNumber}/${pageCount} 页的抽取文本（非行结构，无行号；` +
      `引用请用 文件路径:page ${pageNumber} 格式）]\n${body}`,
  };
}

function formatBytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(1, Math.round(size / 1024))}KB`;
}
