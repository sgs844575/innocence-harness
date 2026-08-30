import type { ExecutionScope } from "@innocenceharness/harness-tools";

/** 磁盘签名：修改时间毫秒 + 字节数，二者一致即视为“自上次读取后未变更”。 */
export interface ReadFileSignature {
  mtimeMs: number;
  size: number;
}

/** 单文件在一个会话（或单次子代理运行）内的上次读取记录。 */
export interface ReadFileRecord {
  signature: ReadFileSignature;
  /** 上次读取是否从首行起覆盖了整个文件（无 offset 裁剪、未截断）。 */
  full: boolean;
}

/**
 * 会话内已读文件登记（M2 文件状态跟踪）。FsPlugin.apply 每次会话组装创建
 * 一个实例，注册表随会话闭包生灭；按“会话根 / 每次子代理运行”分桶——
 * 子代理共享父会话的工具实例，但 ExecutionScope.parentInvocationId 会盖戳，
 * 用它隔离子代理上下文（子代理历史里没有父会话的读取记录，反之亦然）。
 * 桶内按解析后的绝对路径登记磁盘签名与覆盖面。
 */
export interface ReadFileRegistry {
  /** 登记一次读取并返回该桶内此文件的上次记录（首次为 undefined）。 */
  record(
    target: string,
    signature: ReadFileSignature,
    full: boolean,
    contextKey: string,
  ): ReadFileRecord | undefined;
}

export function createReadFileRegistry(): ReadFileRegistry {
  const buckets = new Map<string, Map<string, ReadFileRecord>>();
  const bucketOf = (contextKey: string): Map<string, ReadFileRecord> => {
    let bucket = buckets.get(contextKey);
    if (bucket === undefined) {
      bucket = new Map();
      buckets.set(contextKey, bucket);
    }
    return bucket;
  };
  return {
    record(target, signature, full, contextKey) {
      const bucket = bucketOf(contextKey);
      const previous = bucket.get(target);
      bucket.set(target, { signature, full });
      return previous;
    },
  };
}

/** 分桶键：会话身份 + 父调用戳（顶层运行为 "-"，每个子代理运行各一桶）。 */
export function readContextKey(scope: ExecutionScope): string {
  return `${scope.sessionId ?? "?"}|${scope.parentInvocationId ?? "-"}`;
}

function sameSignature(a: ReadFileSignature, b: ReadFileSignature): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/**
 * 重复读取/磁盘变更注记（源件语义改编：本仓 Read 恒返回真实内容，不做
 * “用已有内容替代重读”的替换式提醒——上下文压缩可能已把早期读取摘走，
 * 假装“内容仍在上下文”会误导；注记只陈述事实并给出变更信号）。
 */
export function renderReadStateNote(previous: ReadFileRecord, current: ReadFileSignature): string {
  if (!sameSignature(previous.signature, current)) {
    return "[文件变更注记：磁盘内容自本会话上次读取后已变化（大小或修改时间不同），此前的行号引用与摘录可能过期，请以本次返回为准]";
  }
  if (previous.full) {
    return "[重复读取注记：本文件本会话已完整读过，磁盘未变更（大小与修改时间一致）；无新信息需求时不必再读，上文副本与当前磁盘一致]";
  }
  return "[重复读取注记：本文件本会话读过（上次为部分读取），磁盘未变更；未覆盖过的区段仍需按需补读]";
}
