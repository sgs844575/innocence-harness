// S4-PDF：Read 的 PDF 面测试——手工最小两页 PDF 夹具 + 探测/分页/越界/回退。
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReadTool, createReadFileRegistry } from "../src";

/** 手工最小合法 PDF（2 页，每页一行文本；xref 偏移按实际拼装计算）。 */
function buildTwoPagePdf(): Buffer {
  const stream = (text: string) => `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`;
  const contentBodies = [stream("HELLO-PDF-PAGE-ONE"), stream("WORLD-PDF-PAGE-TWO")];
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    `<< /Length ${contentBodies[0]!.length} >>\nstream\n${contentBodies[0]}\nendstream`,
    `<< /Length ${contentBodies[1]!.length} >>\nstream\n${contentBodies[1]}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const body of objects) {
    offsets.push(pdf.length);
    pdf += `${offsets.length} 0 obj\n${body}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

let root: string;
const readTool = createReadTool(createReadFileRegistry());
const ctx = () => ({
  workspaceRoot: root,
  signal: new AbortController().signal,
  log: () => {},
  scope: { invocationId: "inv-t", toolName: "Read" },
});

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ic-pdf-"));
  await fs.writeFile(path.join(root, "doc.pdf"), buildTwoPagePdf());
  await fs.writeFile(path.join(root, "plain.txt"), "line1\nline2\n", "utf8");
});

describe("Read PDF face (S4)", () => {
  it("a PDF without page returns page count and pagination guidance only", async () => {
    const r = await readTool.execute({ path: "doc.pdf" }, ctx() as never);
    expect(r.content).toContain("PDF 文档");
    expect(r.content).toContain("共 2 页");
    expect(r.content).toContain("page 参数");
    expect(r.content).not.toContain("HELLO-PDF-PAGE-ONE");
  });

  it("page extraction returns that page's text with page addressing guidance", async () => {
    const page1 = await readTool.execute({ path: "doc.pdf", page: 1 }, ctx() as never);
    expect(page1.content).toContain("1/2 页");
    expect(page1.content).toContain("HELLO-PDF-PAGE-ONE");
    const page2 = await readTool.execute({ path: "doc.pdf", page: 2 }, ctx() as never);
    expect(page2.content).toContain("2/2 页");
    expect(page2.content).toContain("WORLD-PDF-PAGE-TWO");
  });

  it("out-of-range page numbers are rejected with the page count", async () => {
    await expect(readTool.execute({ path: "doc.pdf", page: 9 }, ctx() as never)).rejects.toThrow(
      "页码越界",
    );
  });

  it("page must be an integer >= 1 (validateArgs)", async () => {
    await expect(readTool.validateArgs?.({ path: "doc.pdf", page: 0 })).rejects.toThrow("page");
    await expect(readTool.validateArgs?.({ path: "doc.pdf", page: 1.5 })).rejects.toThrow("page");
  });

  it("text files are unaffected: PDF detection is magic-byte based", async () => {
    const r = await readTool.execute({ path: "plain.txt" }, ctx() as never);
    expect(r.content).toContain("1\tline1");
    expect(r.content).not.toContain("PDF");
  });

  it("persistArgs carries the page parameter", () => {
    expect(readTool.persistArgs({ path: "doc.pdf", page: 2 })).toMatchObject({ page: 2 });
  });
});
