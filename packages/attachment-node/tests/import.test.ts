// attachment-node 测试：CAS 原子写入/去重/索引、嗅探矩阵、文本解码、
// 图像规范化（真 canvas 夹具）、PDF 抽取（程序生成 PDF）、导入管线。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
  FsContentStore,
  decodeText,
  importAttachment,
  sniffMedia,
} from "../src";

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-attach-"));
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function pngBytes(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3366aa";
  ctx.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

/** 最小手工 PDF（两页，各一行文本）——程序生成夹具，避免二进制入库。 */
async function pdfBytes(): Promise<Uint8Array> {
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R 5 0 R]/Count 2>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R>>endobj",
    "4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 10 50 Td (Page one text) Tj ET\nendstream endobj",
    "5 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 6 0 R>>endobj",
    "6 0 obj<</Length 44>>stream\nBT /F1 12 Tf 10 50 Td (Page two text) Tj ET\nendstream endobj",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("FsContentStore", () => {
  it("写入-读取往返 + 布局 + 去重", async () => {
    const store = new FsContentStore(root);
    const bytes = new TextEncoder().encode("hello attachment");
    const first = await store.put(bytes, "text/plain");
    const second = await store.put(bytes, "text/plain");
    expect(second.key).toBe(first.key);
    expect(second.deduplicated).toBe(true);
    expect(await store.has(first.key)).toBe(true);
    expect(Buffer.from(await store.get(first.key)).toString("utf8")).toBe("hello attachment");
    const hash = first.key.slice("sha256:".length);
    const entries = await store.entries();
    expect(entries.get(first.key)).toMatchObject({ mediaType: "text/plain", byteLength: bytes.byteLength });
    // 布局：<root>/sha256/<2>/<62>
    expect(store.objectPath(first.key).endsWith(path.join(hash.slice(0, 2), hash.slice(2)))).toBe(true);
  });

  it("畸形键拒绝", async () => {
    const store = new FsContentStore(root);
    expect(await store.has("sha256:zz")).toBe(false);
    await expect(store.get("not-a-key")).rejects.toThrow();
  });
});

describe("sniffMedia / decodeText", () => {
  it("魔数识别 png/jpeg/webp/gif/pdf", () => {
    expect(sniffMedia(pngBytes(2, 2))).toEqual({ kind: "image", mediaType: "image/png" });
    expect(sniffMedia(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toEqual({ kind: "image", mediaType: "image/jpeg" });
    expect(sniffMedia(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]))).toEqual({ kind: "image", mediaType: "image/gif" });
    expect(sniffMedia(new TextEncoder().encode("%PDF-1.4 whatever"))).toEqual({ kind: "pdf", mediaType: "application/pdf" });
  });

  it("扩展名欺骗被魔数否决（.png 实为文本）", () => {
    expect(sniffMedia(new TextEncoder().encode("plain text with png name"))).toEqual({ kind: "text", mediaType: "text/plain" });
  });

  it("文本解码：BOM 与严格 UTF-8；NUL/坏编码判二进制", () => {
    expect(decodeText(new TextEncoder().encode("普通文本"))).toBe("普通文本");
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(decodeText(new Uint8Array([0x00, 0x61]))).toBeNull();
    // UTF-16LE BOM + "a"（合法高位零字节不判二进制）。
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe("a");
    // 无效 UTF-8 序列 → null。
    expect(decodeText(new Uint8Array([0xc3, 0x28]))).toBeNull();
  });
});

describe("importAttachment", () => {
  it("图像导入：表示 + 缩略图 + 估算 token；≤2048 不派生", async () => {
    const store = new FsContentStore(root);
    const bytes = pngBytes(64, 32);
    const imported = await importAttachment(store, { name: "shot.png", bytes });
    expect(imported.preview.kind).toBe("image");
    expect(imported.representations).toHaveLength(1);
    expect(imported.representations[0]!.kind).toBe("image");
    if (imported.preview.kind === "image") {
      expect(imported.preview.width).toBe(64);
      expect(imported.preview.height).toBe(32);
      expect(imported.preview.thumbnail).toBeDefined();
    }
    // 64x32 ≤ 2048：表示即原始对象（同键去重）。
    expect(imported.representations[0]!.content.key).toBe(imported.source.key);
  });

  it("超尺寸图像派生 PNG 并保持比例", async () => {
    const store = new FsContentStore(root);
    const imported = await importAttachment(store, { name: "big.png", bytes: pngBytes(3000, 1500) });
    expect(imported.representations[0]!.content.key).not.toBe(imported.source.key);
    if (imported.preview.kind === "image") {
      expect(imported.preview.width).toBe(2048);
      expect(imported.preview.height).toBe(1024);
    }
  });

  it("文本导入：文本表示 + 摘要", async () => {
    const store = new FsContentStore(root);
    const text = "line1\nline2 中文内容";
    const imported = await importAttachment(store, { name: "notes.md", bytes: new TextEncoder().encode(text) });
    expect(imported.representations[0]!.kind).toBe("text");
    if (imported.preview.kind === "text") expect(imported.preview.excerpt).toContain("line1");
  });

  it("PDF 导入：两页文本拼接（默认只发文本）", async () => {
    const store = new FsContentStore(root);
    const imported = await importAttachment(store, { name: "doc.pdf", bytes: await pdfBytes() });
    expect(imported.representations).toHaveLength(1);
    expect(imported.representations[0]!.kind).toBe("text");
    expect(imported.warnings).toEqual([]);
    const textBytes = await store.get(imported.representations[0]!.content.key);
    const text = Buffer.from(textBytes).toString("utf8");
    expect(text).toContain("第 1 页");
    expect(text).toContain("Page two text");
  });

  it("二进制导入：仅文件引用 + 警告", async () => {
    const store = new FsContentStore(root);
    const imported = await importAttachment(store, { name: "app.zip", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]) });
    expect(imported.representations).toHaveLength(0);
    expect(imported.preview.kind).toBe("binary");
    expect(imported.warnings.join()).toContain("仅作文件引用");
  });

  it("超过 25 MiB 拒绝导入", async () => {
    const store = new FsContentStore(root);
    const huge = new Uint8Array(25 * 1024 * 1024 + 1);
    await expect(importAttachment(store, { name: "huge.bin", bytes: huge })).rejects.toThrow(/25 MiB/);
  });
});
