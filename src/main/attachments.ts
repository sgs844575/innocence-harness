// 附件主进程面（规格 §10/§12）：CAS 单例（~/.innocence/content）、导入
//（路径/字节 → canonical AttachmentPart + 预览 DTO）、发送门控（件数/形状/
// 对象在位/模型视觉/扫描 PDF）、模型步解析器（文本恒送、图像仅视觉模型）、
// 启动 GC 巡检（转录可达集 + tombstone 规划执行）。纯 Node 逻辑，Electron
// 仅经调用方（IPC/协议 scheme）进入，可 Node 直测。
import fs from "node:fs/promises";
import path from "node:path";
import {
  FsContentStore,
  importAttachment as importAttachmentBytesIntoStore,
} from "@innocenceharness/attachment-node";
import {
  checkMessageAttachmentCount,
  describeAttachmentLimitError,
  planAttachmentGc,
  type ImportedAttachment,
} from "@innocenceharness/attachment-runtime";
import { attachmentValidationError } from "@innocenceharness/plugin-attachments";
import type { AttachmentResolver } from "@innocenceharness/harness-ai-runtime";
import type {
  AttachmentDraftDto,
  AttachmentPart,
  AttachmentPreviewDto,
} from "../shared/ipc";
import { appDataRoot } from "./appDataRoot";

let store: FsContentStore | undefined;

/** CAS 单例：<dataRoot>/content（懒建，随首次导入/查询创建）。 */
export function attachmentStore(): FsContentStore {
  store ??= new FsContentStore(path.join(appDataRoot(), "content"));
  return store;
}

/** 导入产物 → 渲染层 DTO（part 为 canonical 安全引用，不含字节）。 */
function toDraft(imported: ImportedAttachment): AttachmentDraftDto {
  const preview: AttachmentPreviewDto =
    imported.preview.kind === "text"
      ? { kind: "text", excerpt: imported.preview.excerpt }
      : imported.preview.kind === "image"
        ? {
            kind: "image",
            ...(imported.preview.thumbnail ? { thumbnailKey: imported.preview.thumbnail.key } : {}),
            ...(imported.preview.width !== undefined ? { width: imported.preview.width } : {}),
            ...(imported.preview.height !== undefined ? { height: imported.preview.height } : {}),
          }
        : { kind: "binary" };
  return {
    part: {
      type: "attachment",
      name: imported.name,
      source: imported.source,
      representations: imported.representations,
    },
    preview,
    warnings: imported.warnings,
  };
}

/** 按绝对路径导入（资源管理器拖放 / 文件选择器）。 */
export async function importAttachmentFromPath(absPath: string): Promise<AttachmentDraftDto> {
  const name = path.basename(absPath) || "attachment";
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await fs.readFile(absPath));
  } catch {
    throw new Error(`无法读取文件：${name}`);
  }
  return importAttachmentFromBytes(name, bytes);
}

/** 按字节导入（渲染层 File 对象：粘贴 / 拖放入 Web 内容）。 */
export async function importAttachmentFromBytes(name: string, bytes: Uint8Array): Promise<AttachmentDraftDto> {
  const safeName = name.trim() || "attachment";
  const imported = await importAttachmentBytesIntoStore(attachmentStore(), {
    name: safeName,
    bytes,
  });
  return toDraft(imported);
}

/** 活跃模型的视觉能力（true 可送图；false/unknown 阻断图片附件）。 */
export type VisionCapability = boolean | undefined;

/**
 * 发送前权威门控（规格 §7/§10.5）：件数上限、part 形状、CAS 对象在位、
 * 扫描 PDF 显式拒绝、非视觉模型阻断图片表示。任何一条不过即抛错——渲染
 * 层据此提示并保留附件，绝不静默降级。
 */
export async function validateAttachmentsForSend(
  attachments: readonly AttachmentPart[],
  vision: VisionCapability,
): Promise<void> {
  const countError = checkMessageAttachmentCount(attachments.length);
  if (countError) throw new Error(describeAttachmentLimitError(countError));
  const store = attachmentStore();
  for (const part of attachments) {
    const shapeError = attachmentValidationError({ role: "user", parts: [part] });
    if (shapeError) throw new Error(shapeError);
    const present = await store.has(part.source.key);
    if (!present) throw new Error(`附件 ${part.name} 的内容已缺失（可能已被清理），请重新添加`);
    for (const representation of part.representations) {
      if (!(await store.has(representation.content.key))) {
        throw new Error(`附件 ${part.name} 的表示内容已缺失，请重新添加`);
      }
      if (representation.kind === "image" && vision !== true) {
        throw new Error(`当前模型不支持视觉，无法发送图片附件「${part.name}」。请切换视觉模型或移除该图片。`);
      }
    }
    if (
      part.source.mediaType === "application/pdf" &&
      part.representations.length === 0
    ) {
      throw new Error(`「${part.name}」是无可抽取文本的扫描 PDF（页图发送暂不可用），无法提供内容。`);
    }
  }
}

/**
 * 模型步附件解析器：文本表示恒送（CAS 字节直读）；图像表示仅视觉模型
 *（false/unknown 给显式保留说明，不静默丢）；零表示附件给引用注记。
 * 面向模型的说明文本一律英文（规则 16）。
 */
export function createAttachmentResolver(getVision: () => VisionCapability): AttachmentResolver {
  const store = attachmentStore();
  return async (part) => {
    const vision = getVision() === true;
    const pieces: Array<{ type: "text"; text: string } | { type: "image"; image: string; mediaType: string }> = [];
    for (const representation of part.representations) {
      const bytes = await store.get(representation.content.key);
      if (representation.kind === "text") {
        pieces.push({ type: "text", text: Buffer.from(bytes).toString("utf8") });
      } else if (vision) {
        pieces.push({
          type: "image",
          image: Buffer.from(bytes).toString("base64"),
          mediaType: representation.content.mediaType,
        });
      } else {
        pieces.push({
          type: "text",
          text: `[Image attachment "${part.name}" is withheld: the active model has no vision capability.]`,
        });
      }
    }
    if (pieces.length === 0) {
      pieces.push({
        type: "text",
        text: `[Attachment "${part.name}" (${part.source.mediaType}, ${part.source.byteLength} bytes) has no model-readable representation.]`,
      });
    }
    return pieces;
  };
}

/** 转录文本里的全部内容引用键（可达集，GC 巡检用）。 */
const KEY_RE = /sha256:[0-9a-f]{64}/g;

async function collectReachableKeys(jsonlRoots: readonly string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const text = await fs.readFile(full, "utf8").catch(() => "");
        for (const match of text.matchAll(KEY_RE)) keys.add(match[0]);
      }
    }
  };
  for (const root of jsonlRoots) await walk(root);
  return keys;
}

/** 启动 GC 巡检（best-effort，永不抛错）：转录可达 → tombstone 规划 → 执行。 */
export async function sweepAttachments(
  jsonlRoots: readonly string[],
  log: (level: "info" | "warn", msg: string, data?: unknown) => void,
): Promise<void> {
  try {
    const store = attachmentStore();
    const entries = await store.entries();
    const tombstoneFile = path.join(appDataRoot(), "content", "gc.json");
    let previous = new Map<string, number>();
    try {
      const raw = JSON.parse(await fs.readFile(tombstoneFile, "utf8")) as Record<string, number>;
      for (const [key, since] of Object.entries(raw)) {
        if (typeof since === "number") previous.set(key, since);
      }
    } catch {
      // 无表/坏表 = 空起点。
    }
    const reachable = await collectReachableKeys(jsonlRoots);
    const plan = planAttachmentGc([...entries.keys()], reachable, previous, Date.now());
    for (const key of plan.delete) {
      await store.delete(key).catch(() => undefined);
    }
    await fs.mkdir(path.dirname(tombstoneFile), { recursive: true });
    await fs.writeFile(tombstoneFile, JSON.stringify(Object.fromEntries(plan.tombstones), null, 2));
    if (plan.delete.length > 0 || plan.mark.length > 0) {
      log("info", "attachments gc", { marked: plan.mark.length, deleted: plan.delete.length, resurrected: plan.resurrect.length });
    }
  } catch (error) {
    log("warn", "attachments gc failed", { error: String(error) });
  }
}
