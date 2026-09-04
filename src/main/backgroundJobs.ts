// S1 后台会话运行器宿主胶水：把 harness-background 作业服务接到运行时发送
// 面（复用 4D 的回复观察器——镜像增量 + 错误旗标）、会话存储（后台作业 =
// 普通会话，blocked 后用户可选中继续对话）、作业暂存目录与通知汇。
// 依赖注入便于 Node 直测；harnessGlue 持有生产装配。
// 暂存目录保留策略：本波无清理面（会话删除亦不清）——目录只增不减，
// 后续作业生命周期波补清扫；在此明示而非默认静默。
import fs from "node:fs";
import path from "node:path";
import {
  createBackgroundJobService,
  type BackgroundJobOutcome,
} from "@innocenceharness/harness-background";
import {
  appendObservedReplyDelta,
  beginObservedReply,
  endObservedReply,
  ownReplyText,
} from "./automationReplyObserver";

/** 作业状态 → 通知标题（用户文案在宿主侧格式化，包保持结构化）。 */
const NOTIFICATION_TITLES: Record<BackgroundJobOutcome["status"], string> = {
  done: "后台任务完成",
  blocked: "后台任务需要输入",
  failed: "后台任务失败",
};

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

export interface BackgroundJobsOptions {
  runtime: {
    send(request: {
      sessionId: string;
      taskId: string;
      routeId: string;
      text: string;
      messageId: string;
    }): Promise<void>;
  };
  createSession(title: string, workspaceRoot?: string): { id: string };
  /** 会话落账面（与正常聊天路径同形）：用户回合与助手占位进存储，
   *  令运行时钩子的 updateMessage 有落点、用户打开会话即可见进度。 */
  appendUserMessage(sessionId: string, text: string): void;
  appendAssistantPlaceholder(sessionId: string, messageId: string): void;
  /** 作业暂存目录的父目录（每作业一子目录，信封注入给代理）。 */
  scratchRoot(): string;
  notify(message: { title: string; text: string }): Promise<void>;
  onNotifyError?(error: unknown): void;
  log?(level: "info" | "warn" | "error", msg: string, data?: unknown): void;
  id?(): string;
}

export interface BackgroundJobStartResult {
  jobId: string;
  sessionId: string;
  status: "working";
}

export interface BackgroundJobsFacade {
  start(prompt: string, options?: { workspaceRoot?: string }): Promise<BackgroundJobStartResult>;
}

export function createBackgroundJobs(options: BackgroundJobsOptions): BackgroundJobsFacade {
  const service = createBackgroundJobService({
    runJob: async ({ sessionId, messageId, envelope }) => {
      // 信封按用户回合落账：与 persistTurn 回放口径一致（重启后所见即当时
      // 所发），助手占位携带 messageId 让增量/完成钩子有更新落点。
      options.appendUserMessage(sessionId, envelope);
      options.appendAssistantPlaceholder(sessionId, messageId);
      beginObservedReply(messageId);
      try {
        await options.runtime.send({
          sessionId,
          taskId: "",
          routeId: "main",
          text: envelope,
          messageId,
        });
        const reply = endObservedReply(messageId);
        return {
          replyText: ownReplyText(reply.text),
          errored: reply.errored,
          ...(reply.error !== undefined ? { error: reply.error } : {}),
        };
      } catch (error) {
        endObservedReply(messageId);
        throw error;
      }
    },
    notify: async ({ jobTitle, outcome }) => {
      const title = NOTIFICATION_TITLES[outcome.status];
      await options.notify({
        title,
        text: `[${jobTitle}] ${outcome.headline.trim() || title}`,
      });
    },
    onNotifyError: options.onNotifyError,
    log: options.log,
  });
  return {
    async start(prompt, startOptions) {
      const trimmed = prompt.trim();
      if (!trimmed) throw new Error("background job prompt is required");
      const title = firstLine(trimmed).slice(0, 40) || "后台任务";
      const workspaceRoot = startOptions?.workspaceRoot?.trim() || undefined;
      const session = options.createSession(`后台：${title}`, workspaceRoot);
      const jobId =
        options.id?.() ?? `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const scratchDir = path.join(options.scratchRoot(), jobId);
      fs.mkdirSync(scratchDir, { recursive: true });
      // 即回工作态记录，运行在后台落定（通知走状态驱动面）。
      void service
        .start({ jobId, sessionId: session.id, title, scratchDir, prompt: trimmed })
        .catch((error: unknown) => {
          options.log?.("error", "background job crashed", { jobId, error: String(error) });
        });
      return { jobId, sessionId: session.id, status: "working" };
    },
  };
}

/** 测试可见：镜像一条增量到观察器（生产路径由 runtimeHooks 驱动）。 */
export const testHooks = { appendObservedReplyDelta };
