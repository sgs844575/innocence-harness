import { describe, expect, it, vi } from "vitest";
import {
  backgroundOutcomeOf,
  buildBackgroundJobTurn,
  createBackgroundJobService,
  extractBackgroundOutcome,
  type BackgroundJobPorts,
} from "../src";

describe("status-line extraction (S1)", () => {
  it("maps the three protocol markers to their statuses with same-line headlines", () => {
    expect(extractBackgroundOutcome("干完了\nresult: 修复已提交到 src/a.ts")).toEqual({
      status: "done",
      headline: "修复已提交到 src/a.ts",
    });
    expect(extractBackgroundOutcome("需要凭据\nneeds input: 提供 API key")).toEqual({
      status: "blocked",
      headline: "提供 API key",
    });
    expect(extractBackgroundOutcome("failed: 仓库不是 Git")).toEqual({
      status: "failed",
      headline: "仓库不是 Git",
    });
  });

  it("a bare terminal marker yields an empty headline; a marker that is not the last non-empty line is not terminal", () => {
    expect(extractBackgroundOutcome("收尾说明\nresult:")).toEqual({ status: "done", headline: "" });
    // 标记后还有正文 → 不是终止标记（协议要求 at the very end）。
    expect(extractBackgroundOutcome("result:\n交付：三处修复与测试")).toBeUndefined();
  });

  it("only the last non-empty line counts; quoted mid-line mentions do not", () => {
    expect(extractBackgroundOutcome("result: 中间说法\n继续工作\nfailed: 前提不成立")).toEqual({
      status: "failed",
      headline: "前提不成立",
    });
    // 非独立行（行中引用）不构成信号；裸标记不作降级标题。
    expect(extractBackgroundOutcome("我说过 result: 但那只是叙述")).toBeUndefined();
    expect(backgroundOutcomeOf("result:\n交付正文", false)).toEqual({
      status: "done",
      headline: "交付正文",
    });
  });

  it("error flag dominates; no marker degrades to done with the first non-empty line", () => {
    expect(backgroundOutcomeOf("result: 完成", true)).toMatchObject({ status: "failed" });
    expect(backgroundOutcomeOf("partial", true, "complete provider diagnostic")).toEqual({
      status: "failed",
      headline: "complete provider diagnostic",
    });
    expect(backgroundOutcomeOf("三处修复已完成\n测试全绿", false)).toEqual({
      status: "done",
      headline: "三处修复已完成",
    });
    expect(backgroundOutcomeOf("", false)).toEqual({ status: "done", headline: "" });
  });
});

describe("background job envelope (S1)", () => {
  it("carries the title, task, scratch directory and the three protocol markers", () => {
    const envelope = buildBackgroundJobTurn({
      title: "修复构建",
      scratchDir: "C:/userData/background/bg_1",
      prompt: "修复 CI 的类型错误",
    });
    expect(envelope).toContain("修复构建");
    expect(envelope).toContain("修复 CI 的类型错误");
    expect(envelope).toContain("C:/userData/background/bg_1");
    expect(envelope).toContain('"result:"');
    expect(envelope).toContain('"needs input:"');
    expect(envelope).toContain('"failed:"');
    // 收尾行动性报告契约在场 + 暂存目录隔离纪律在场。
    expect(envelope).toContain("report the reader can use directly");
    expect(envelope).toContain("must not write into each other's");
  });
});

describe("background job service (S1)", () => {
  function makePorts(overrides: { runJob?: BackgroundJobPorts["runJob"]; notify?: BackgroundJobPorts["notify"] } = {}) {
    const runJob = vi.fn(overrides.runJob ?? (async () => ({ replyText: "result: 完成", errored: false })));
    const notify = vi.fn(overrides.notify ?? (async () => {}));
    return { runJob, notify };
  }

  it("runs one job to a terminal record with a state-driven notification", async () => {
    const { runJob, notify } = makePorts();
    const service = createBackgroundJobService({ runJob, notify, now: () => 1_000, log: () => {} });
    const record = await service.start({
      jobId: "bg_1",
      sessionId: "sess_1",
      title: "修复构建",
      scratchDir: "C:/scratch",
      prompt: "修复 CI",
    });
    expect(runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        messageId: expect.stringMatching(/^background_bg_1_/),
        envelope: expect.stringContaining("修复 CI"),
      }),
    );
    expect(record).toMatchObject({ status: "done", headline: "完成", startedAt: 1000, endedAt: 1000 });
    expect(notify).toHaveBeenCalledWith({
      jobTitle: "修复构建",
      outcome: { status: "done", headline: "完成" },
    });
    expect(service.list()).toHaveLength(1);
  });

  it("marks failed runs failed and keeps the record visible", async () => {
    const { runJob, notify } = makePorts({
      runJob: async () => ({ replyText: "needs input: 提供凭据", errored: true }),
    });
    const service = createBackgroundJobService({ runJob, notify, now: () => 1_000, log: () => {} });
    const record = await service.start({
      jobId: "bg_2",
      sessionId: "sess_2",
      title: "发布",
      scratchDir: "C:/scratch2",
      prompt: "发布包",
    });
    expect(record.status).toBe("failed");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: expect.objectContaining({ status: "failed" }) }),
    );
  });

  it("notification failure is observed but never fails the job", async () => {
    const { runJob, notify } = makePorts({ notify: async () => Promise.reject(new Error("渠道不可用")) });
    const onNotifyError = vi.fn();
    const service = createBackgroundJobService({ runJob, notify, onNotifyError, now: () => 1_000, log: () => {} });
    const record = await service.start({
      jobId: "bg_3",
      sessionId: "sess_3",
      title: "t",
      scratchDir: "s",
      prompt: "p",
    });
    expect(record.status).toBe("done");
    expect(onNotifyError).toHaveBeenCalled();
  });
});
