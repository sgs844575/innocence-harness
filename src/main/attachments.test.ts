// 附件主进程面 Node 测试：导入往返（CAS 在位/预览 DTO）、发送门控矩阵
//（件数/形状/在位/视觉/扫描 PDF）、解析器（文本恒送/图像按视觉/零表示注记）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { initAppDataRoot } from "./appDataRoot";
import {
  attachmentStore,
  createAttachmentResolver,
  importAttachmentFromBytes,
  importAttachmentFromPath,
  validateAttachmentsForSend,
} from "./attachments";
import type { AttachmentPart } from "../shared/ipc";

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-attach-main-"));
  initAppDataRoot(root);
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function png(name: string): { name: string; bytes: Uint8Array } {
  const canvas = createCanvas(24, 24);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2088aa";
  ctx.fillRect(0, 0, 24, 24);
  return { name, bytes: new Uint8Array(canvas.toBuffer("image/png")) };
}

describe("import round trip", () => {
  it("字节导入返回 part + 预览（缩略图键/尺寸），CAS 对象在位", async () => {
    const { name, bytes } = png("shot.png");
    const draft = await importAttachmentFromBytes(name, bytes);
    expect(draft.part.type).toBe("attachment");
    expect(draft.part.name).toBe("shot.png");
    expect(draft.part.representations[0]!.kind).toBe("image");
    expect(draft.preview.kind).toBe("image");
    if (draft.preview.kind === "image") {
      expect(draft.preview.width).toBe(24);
      expect(draft.preview.thumbnailKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(await attachmentStore().has(draft.part.source.key)).toBe(true);
  });

  it("路径导入：读取文件并按基名命名；不可读抛结构化错误", async () => {
    const file = path.join(root, "notes.txt");
    await fs.writeFile(file, "hello notes", "utf8");
    const draft = await importAttachmentFromPath(file);
    expect(draft.part.name).toBe("notes.txt");
    expect(draft.preview.kind).toBe("text");
    await expect(importAttachmentFromPath(path.join(root, "missing.bin"))).rejects.toThrow("无法读取文件");
  });
});

describe("validateAttachmentsForSend", () => {
  it("合法图片 + 视觉模型通过；非视觉模型拒绝且不静默", async () => {
    const { name, bytes } = png("ok.png");
    const { part } = await importAttachmentFromBytes(name, bytes);
    await expect(validateAttachmentsForSend([part], true)).resolves.toBeUndefined();
    await expect(validateAttachmentsForSend([part], false)).rejects.toThrow("不支持视觉");
    await expect(validateAttachmentsForSend([part], undefined)).rejects.toThrow("不支持视觉");
  });

  it("CAS 对象缺失拒绝（伪造/被清理的引用）", async () => {
    const forged: AttachmentPart = {
      type: "attachment",
      name: "ghost.png",
      source: { key: `sha256:${"9".repeat(64)}`, mediaType: "image/png", byteLength: 1 },
      representations: [],
    };
    await expect(validateAttachmentsForSend([forged], true)).rejects.toThrow("内容已缺失");
  });

  it("件数上限与扫描 PDF 显式拒绝", async () => {
    const { name, bytes } = png("a.png");
    const { part } = await importAttachmentFromBytes(name, bytes);
    const eleven = Array.from({ length: 11 }, () => part);
    await expect(validateAttachmentsForSend(eleven, true)).rejects.toThrow("最多 10 个");
    // 扫描 PDF 分支：source 对象必须在位（真实导入的零表示 PDF 形态）。
    const stored = await attachmentStore().put(new TextEncoder().encode("%PDF-1.4 scanned"), "application/pdf");
    const scanned: AttachmentPart = {
      type: "attachment",
      name: "scan.pdf",
      source: { key: stored.key, mediaType: "application/pdf", byteLength: stored.byteLength },
      representations: [],
    };
    await expect(validateAttachmentsForSend([scanned], true)).rejects.toThrow("扫描 PDF");
  });
});

describe("createAttachmentResolver", () => {
  it("文本表示恒送；图像按视觉能力送或给保留说明；零表示给引用注记", async () => {
    const textDraft = await importAttachmentFromBytes("notes.md", new TextEncoder().encode("# 标题\n正文"));
    const imageDraft = await importAttachmentFromBytes(png("shot.png").name, png("shot.png").bytes);
    const binaryDraft = await importAttachmentFromBytes("app.zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]));

    const visionPieces = await createAttachmentResolver(() => true)(imageDraft.part);
    expect(visionPieces[0]).toMatchObject({ type: "image", mediaType: "image/png" });

    const blindPieces = await createAttachmentResolver(() => undefined)(imageDraft.part);
    expect(blindPieces[0]).toMatchObject({ type: "text" });
    expect((blindPieces[0] as { text: string }).text).toContain("withheld");

    const textPieces = await createAttachmentResolver(() => false)(textDraft.part);
    expect(textPieces[0]).toMatchObject({ type: "text", text: expect.stringContaining("标题") });

    const nonePieces = await createAttachmentResolver(() => true)(binaryDraft.part);
    expect((nonePieces[0] as { text: string }).text).toContain("no model-readable representation");
  });
});
