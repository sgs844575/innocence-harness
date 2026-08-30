// S1 后台作业胶水：注入端口直测（真实回复观察器 + 会话落账 + 状态驱动通知
// + 暂存目录 + 工作区绑定）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBackgroundJobs, testHooks } from "./backgroundJobs";

interface Fixture {
  facade: ReturnType<typeof createBackgroundJobs>;
  sent: Array<{ sessionId: string; text: string; messageId: string }>;
  userMessages: Array<{ sessionId: string; text: string }>;
  placeholders: Array<{ sessionId: string; messageId: string }>;
  createdSessions: Array<{ title: string; workspaceRoot?: string }>;
  notifications: Array<{ title: string; text: string }>;
  logs: string[];
  scratchRoot: string;
}

function fixture(overrides: { reply?: string; errored?: boolean; sendError?: Error } = {}): Fixture {
  const sent: Fixture["sent"] = [];
  const userMessages: Fixture["userMessages"] = [];
  const placeholders: Fixture["placeholders"] = [];
  const createdSessions: Fixture["createdSessions"] = [];
  const notifications: Fixture["notifications"] = [];
  const logs: string[] = [];
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ic-bg-"));
  const runtime = {
    async send(request: { sessionId: string; text: string; messageId: string }) {
      sent.push(request);
      if (overrides.sendError) throw overrides.sendError;
      if (overrides.reply !== undefined) {
        testHooks.appendObservedReplyDelta(request.messageId, overrides.reply);
      }
    },
  };
  const facade = createBackgroundJobs({
    runtime,
    createSession: (title, workspaceRoot) => {
      createdSessions.push({ title, workspaceRoot });
      return { id: "sess_bg" };
    },
    appendUserMessage: (sessionId, text) => userMessages.push({ sessionId, text }),
    appendAssistantPlaceholder: (sessionId, messageId) => placeholders.push({ sessionId, messageId }),
    scratchRoot: () => scratchRoot,
    notify: async (message) => {
      notifications.push(message);
    },
    id: () => "bg_test",
    log: (_level, msg) => logs.push(msg),
  });
  return { facade, sent, userMessages, placeholders, createdSessions, notifications, logs, scratchRoot };
}

describe("background jobs glue (S1)", () => {
  it("creates a titled session, seeds a scratch dir, and injects the envelope", async () => {
    const { facade, sent, scratchRoot, createdSessions } = fixture({ reply: "result: 修复完成" });
    const started = await facade.start("修复构建的类型错误\n并把结果写在报告里");
    expect(started).toMatchObject({ jobId: "bg_test", status: "working" });
    expect(createdSessions).toEqual([{ title: "后台：修复构建的类型错误", workspaceRoot: undefined }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.sessionId).toBe(started.sessionId);
    expect(sent[0]!.text).toContain("修复构建的类型错误");
    expect(sent[0]!.text).toContain(path.join(scratchRoot, "bg_test"));
    // 暂存目录已建。
    expect(fs.existsSync(path.join(scratchRoot, "bg_test"))).toBe(true);
  });

  it("records the envelope as the user turn and an assistant placeholder keyed by messageId", async () => {
    const { facade, sent, userMessages, placeholders } = fixture({ reply: "result: 完成" });
    const started = await facade.start("任务");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(userMessages).toEqual([{ sessionId: started.sessionId, text: sent[0]!.text }]);
    expect(placeholders).toEqual([{ sessionId: started.sessionId, messageId: sent[0]!.messageId }]);
  });

  it("binds the job session to the provided workspace root", async () => {
    const { facade, createdSessions } = fixture();
    await facade.start("任务", { workspaceRoot: "D:/proj-x" });
    expect(createdSessions[0]).toMatchObject({ workspaceRoot: "D:/proj-x" });
  });

  it("settles through the observer into a state-driven notification", async () => {
    const { facade, notifications } = fixture({ reply: "收尾说明\nresult: 三处修复已验证" });
    await facade.start("任务");
    await vi.waitFor(() => expect(notifications).toHaveLength(1));
    expect(notifications[0]).toEqual({
      title: "后台任务完成",
      text: "[任务] 三处修复已验证",
    });
  });

  it("maps blocked and error replies to their notification titles", async () => {
    const blocked = fixture({ reply: "needs input: 提供发布凭据" });
    await blocked.facade.start("发布");
    await vi.waitFor(() => expect(blocked.notifications).toHaveLength(1));
    expect(blocked.notifications[0]!.title).toBe("后台任务需要输入");

    const failed = fixture({ reply: "failed: 前提不成立", errored: true });
    await failed.facade.start("检查");
    await vi.waitFor(() => expect(failed.notifications).toHaveLength(1));
    expect(failed.notifications[0]!.title).toBe("后台任务失败");
  });

  it("a runtime send rejection never escapes start and is logged", async () => {
    const { facade, logs } = fixture({ sendError: new Error("端口失效") });
    await expect(facade.start("任务")).resolves.toMatchObject({ status: "working" });
    await vi.waitFor(() => expect(logs).toContain("background job crashed"));
  });

  it("rejects empty prompts without creating anything", async () => {
    const { facade, sent } = fixture();
    await expect(facade.start("   ")).rejects.toThrow("prompt");
    expect(sent).toHaveLength(0);
  });
});
