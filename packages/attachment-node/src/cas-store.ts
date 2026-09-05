// FS 内容寻址存储（规格 §6）：<root>/content/sha256/<2 字节>/<62 hex>，
// 临时文件 + 原子 rename 写入、同内容天然去重；<root>/content/index.json 维护
// key → {mediaType, byteLength, at} 元数据（内容协议 scheme 的 MIME 源与
// GC 的对象清单）。纯 Node，无 Electron。
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ContentStore, StoredObject } from "@innocenceharness/attachment-runtime";

/** index.json 的一条对象元数据。 */
export interface ContentIndexEntry {
  mediaType: string;
  byteLength: number;
  at: number;
}

export class FsContentStore implements ContentStore {
  private readonly root: string;
  private readonly indexFile: string;
  private index: Map<string, ContentIndexEntry> | undefined;
  private indexDirty = false;
  /** 序列化写锁：并发放行的 rename 安全，但 index 写必须串行。 */
  private indexWrite: Promise<void> = Promise.resolve();

  constructor(contentRoot: string) {
    this.root = path.join(contentRoot, "sha256");
    this.indexFile = path.join(contentRoot, "index.json");
  }

  /** 内容布局内的对象绝对路径（GC 删除与内容协议共用）。 */
  objectPath(key: string): string {
    const hash = key.startsWith("sha256:") ? key.slice("sha256:".length) : key;
    return path.join(this.root, hash.slice(0, 2), hash.slice(2));
  }

  async put(bytes: Uint8Array, mediaType = "application/octet-stream"): Promise<StoredObject> {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const key = `sha256:${hash}`;
    const target = this.objectPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    let deduplicated = false;
    try {
      await fs.access(target);
      deduplicated = true;
    } catch {
      // 临时文件同目录写入后原子改名：中断不留半成品对象名。
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temp, bytes);
      try {
        await fs.rename(temp, target);
      } catch (error) {
        await fs.rm(temp, { force: true });
        // 并发同内容竞态：rename 跨卷/目标已存在时回退为去重命中。
        try {
          await fs.access(target);
          deduplicated = true;
        } catch {
          throw error;
        }
      }
    }
    await this.recordIndex(key, { mediaType, byteLength: bytes.byteLength, at: Date.now() }, deduplicated);
    return { key, byteLength: bytes.byteLength, deduplicated };
  }

  async has(key: string): Promise<boolean> {
    if (!/^sha256:[0-9a-f]{64}$/.test(key)) return false;
    try {
      await fs.access(this.objectPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Uint8Array> {
    if (!/^sha256:[0-9a-f]{64}$/.test(key)) throw new Error(`content store: invalid key`);
    try {
      return new Uint8Array(await fs.readFile(this.objectPath(key)));
    } catch {
      throw new Error(`content store: object missing: ${key}`);
    }
  }

  /** 全量对象键 + 元数据（GC 清单与内容协议 MIME 查询）。 */
  async entries(): Promise<Map<string, ContentIndexEntry>> {
    if (!this.index) await this.loadIndex();
    return new Map(this.index!);
  }

  /** GC 物理删除（调用方已按 tombstone 到期裁定）。 */
  async delete(key: string): Promise<void> {
    await fs.rm(this.objectPath(key), { force: true });
    if (this.index?.delete(key)) this.indexDirty = true;
    await this.flushIndex();
  }

  private async recordIndex(key: string, entry: ContentIndexEntry, deduplicated: boolean): Promise<void> {
    if (!this.index) await this.loadIndex();
    if (!deduplicated || !this.index!.has(key)) {
      this.index!.set(key, entry);
      this.indexDirty = true;
    }
    await this.flushIndex();
  }

  private async loadIndex(): Promise<void> {
    this.index = new Map();
    try {
      const raw = JSON.parse(await fs.readFile(this.indexFile, "utf8")) as Record<string, ContentIndexEntry>;
      for (const [key, entry] of Object.entries(raw)) {
        if (/^sha256:[0-9a-f]{64}$/.test(key) && entry && typeof entry.mediaType === "string") {
          this.index.set(key, entry);
        }
      }
    } catch {
      // 索引损坏 = 重建（对象仍在树内；mediaType 缺失条目按 octet-stream 服务）。
    }
  }

  private flushIndex(): Promise<void> {
    const run = this.indexWrite.then(async () => {
      if (!this.indexDirty || !this.index) return;
      const temp = `${this.indexFile}.tmp`;
      await fs.mkdir(path.dirname(this.indexFile), { recursive: true });
      await fs.writeFile(temp, JSON.stringify(Object.fromEntries(this.index), null, 2));
      await fs.rename(temp, this.indexFile);
      this.indexDirty = false;
    });
    // 链自愈：一次瞬时写失败（AV/索引器锁文件）只让本次调用方看到错误，
    // 链本体吞掉 rejection 继续接后续写——否则一次 EBUSY 毒化整条链，
    // 此后每次导入都失败直到重启。
    this.indexWrite = run.catch(() => undefined);
    return run;
  }
}
