// 附件 GC 规划（规格 §6）：纯函数，无 IO —— 宿主按规划执行。可达集来自
// 转录扫描（transcript/task/manifest 的 ContentRef）；对象首次不可达时写
// tombstone（记录时间），连续不可达 30 天后物理删除；任何新引用撤销
// tombstone（回到 alive）。

/** tombstone 表：key → 首次不可达时刻（Unix 毫秒）。 */
export type Tombstones = ReadonlyMap<string, number>;

/** 连续不可达多久后物理删除。 */
export const GC_TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

export interface GcPlan {
  /** 仍存活（或重新可达）：从 tombstone 表撤销。 */
  resurrect: string[];
  /** 新不可达：写入/保持 tombstone（首次时间戳）。 */
  mark: Array<{ key: string; since: number }>;
  /** tombstone 到期：物理删除并移除表项。 */
  delete: string[];
  /** 规划后的 tombstone 全量状态（宿主整体持久化）。 */
  tombstones: Map<string, number>;
}

/**
 * 规划一次 mark-and-sweep：storedKeys 为存储内全部对象键，reachableKeys 为
 * 本轮扫描到的引用键，previous 为上一轮 tombstone 表，now 为当前时刻。
 */
export function planAttachmentGc(
  storedKeys: readonly string[],
  reachableKeys: ReadonlySet<string>,
  previous: Tombstones,
  now: number,
): GcPlan {
  const next = new Map<string, number>();
  const resurrect: string[] = [];
  const mark: Array<{ key: string; since: number }> = [];
  const deletions: string[] = [];
  for (const key of storedKeys) {
    if (reachableKeys.has(key)) {
      if (previous.has(key)) resurrect.push(key);
      continue;
    }
    const since = previous.get(key) ?? now;
    next.set(key, since);
    if (since === now) mark.push({ key, since });
    if (now - since >= GC_TOMBSTONE_MS) deletions.push(key);
  }
  // 到期删除的键从表里移除（对象删除后不再追踪）。
  for (const key of deletions) next.delete(key);
  return { resurrect, mark, delete: deletions, tombstones: next };
}
