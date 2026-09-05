// 限制校验与 GC 规划的纯逻辑测试。
import { describe, expect, it } from "vitest";
import {
  checkImportSize,
  checkMessageAttachmentCount,
  describeAttachmentLimitError,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  GC_TOMBSTONE_MS,
  planAttachmentGc,
} from "../src";

describe("attachment limits", () => {
  it("25 MiB 内通过，超限拒绝且不截断", () => {
    expect(checkImportSize("a.png", MAX_ATTACHMENT_BYTES)).toBeNull();
    const over = checkImportSize("a.png", MAX_ATTACHMENT_BYTES + 1);
    expect(over).toEqual({ kind: "too-large", byteLength: MAX_ATTACHMENT_BYTES + 1, name: "a.png" });
    expect(describeAttachmentLimitError(over!)).toContain("a.png");
  });

  it("单消息附件数上限", () => {
    expect(checkMessageAttachmentCount(MAX_ATTACHMENTS_PER_MESSAGE)).toBeNull();
    expect(checkMessageAttachmentCount(MAX_ATTACHMENTS_PER_MESSAGE + 1)).toEqual({
      kind: "too-many",
      count: MAX_ATTACHMENTS_PER_MESSAGE + 1,
    });
  });
});

describe("planAttachmentGc", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const key = (n: number) => `sha256:${String(n).padStart(64, "0")}`;

  it("新不可达对象打 tombstone（首次时间戳），到期对象删除并出表", () => {
    const now = 1_000_000_000;
    const old = key(1);
    const fresh = key(2);
    const previous = new Map([[old, now - GC_TOMBSTONE_MS - 1]]);
    const plan = planAttachmentGc([old, fresh], new Set(), previous, now);
    expect(plan.delete).toEqual([old]);
    expect(plan.mark).toEqual([{ key: fresh, since: now }]);
    expect(plan.tombstones.has(old)).toBe(false);
    expect(plan.tombstones.get(fresh)).toBe(now);
  });

  it("重新可达即复活（撤销 tombstone），tombstone 未到期保持", () => {
    const now = 1_000_000_000;
    const a = key(1);
    const b = key(2);
    const previous = new Map([
      [a, now - 10 * DAY],
      [b, now - 10 * DAY],
    ]);
    const plan = planAttachmentGc([a, b], new Set([a]), previous, now);
    expect(plan.resurrect).toEqual([a]);
    expect(plan.delete).toEqual([]);
    expect(plan.tombstones.has(a)).toBe(false);
    expect(plan.tombstones.get(b)).toBe(now - 10 * DAY);
  });

  it("存储外的陈旧 tombstone 表项被丢弃", () => {
    const now = 1_000_000_000;
    const gone = key(9);
    const plan = planAttachmentGc([], new Set(), new Map([[gone, now - DAY]]), now);
    expect(plan.tombstones.size).toBe(0);
    expect(plan.delete).toEqual([]);
  });
});
