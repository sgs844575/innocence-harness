// PDF 文本抽取（规格 §2/§9 默认路径）：pdfjs-dist 按页抽取文本，页间拼接为
// 单一文本表示（页标记分隔）；页数超限拒绝导入；无可抽取文本（扫描件）以
// 警告 + 二进制引用落地，发送侧门控再拒绝。页图渲染是显式选送路径，本波
// 未实现（诚实边界：UI 不提供页选择）。
import { MAX_PDF_PAGES } from "@innocenceharness/attachment-runtime";

export interface PdfTextExtract {
  text: string;
  pageCount: number;
  /** 全文零可抽取字符（扫描/纯图形 PDF）。 */
  scanned: boolean;
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtract> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const pageCount = doc.numPages;
    if (pageCount > MAX_PDF_PAGES) {
      throw new Error(`PDF 页数超过上限（${pageCount} > ${MAX_PDF_PAGES}）`);
    }
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/[ \t]+/g, " ")
          .trim();
        pages.push(text);
      } finally {
        page.cleanup();
      }
    }
    const total = pages.reduce((sum, page) => sum + page.length, 0);
    const text = pages
      .map((page, index) => `--- 第 ${index + 1} 页 ---\n${page}`)
      .join("\n\n");
    return { text, pageCount, scanned: total === 0 };
  } finally {
    await doc.destroy();
  }
}
