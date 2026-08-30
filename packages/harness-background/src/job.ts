// S1 后台会话运行器：作业信封与编排服务。信封为一次机器身份触发的自含
// 任务回合（scratch 目录纪律 + 叙述/复述约定 + 状态行协议 + 收尾行动性
// 报告契约——源件 background-session-instructions 与 background-job-agent
// 两件语义的英文改编）；服务经注入端口驱动一次运行并落终态记录，通知面
// 按状态语义投递（宿主侧格式化为用户文案）。4D 前台自动化循环保持特例，
// 本服务是其泛化而非替换。
import type { BackgroundJobOutcome, BackgroundJobStatus } from "./status";
import { backgroundOutcomeOf } from "./status";

export type { BackgroundJobOutcome, BackgroundJobStatus } from "./status";
export { backgroundOutcomeOf, extractBackgroundOutcome } from "./status";

export interface BackgroundJobTurnInput {
  title: string;
  scratchDir: string;
  prompt: string;
}

/**
 * 后台作业回合信封（LLM 面，英文书写）：交待后台身份与"为离场读者写作"，
 * 任务本体、scratch 目录、叙述/复述纪律、收尾行动性报告与状态行协议。
 */
export function buildBackgroundJobTurn(input: BackgroundJobTurnInput): string {
  return [
    `This turn starts the background job "${input.title}". The user kicked it off and may read it live or later, so write for someone checking in cold, and never describe yourself as a background agent.`,
    "",
    "The task:",
    input.prompt,
    "",
    "Working conventions:",
    `- Scratch space: put every temporary artifact (scripts, query files, intermediate outputs) under ${input.scratchDir}. Parallel jobs run with separate scratch locations and must not write into each other's; anything worth keeping belongs in the workspace itself, not in scratch.`,
    "- Narrate briefly: one line on the approach before acting, and after each chunk of work say what happened and what comes next.",
    "- Restate outcomes in your own message text even when a tool already printed them - the job tracker reads only your message text, never tool output.",
    "- File changes are fenced in this job: call the EnterWorktree tool once to create your isolated worktree before the first file edit, then write only inside it; reads and scratch are never fenced. If that tool is unavailable or fails, keep going without editing files.",
    "",
    "Finish with a report the reader can use directly: what was done, where to find it (a path, or the answer in your own text), plus the next command when one would help. Then mark the outcome with exactly one standalone status line at the very end:",
    '- "result:" followed by a one-line, self-contained headline, once the ask is delivered - verify before claiming it (run a test or build, or read the request again) and name what you checked. Deliverable answers count; work that must still settle before it counts as delivered stays narration rather than a result.',
    '- "needs input:" followed by exactly the one human action that unblocks you. Choose it only when a reasonable guess does not exist; when a defensible assumption exists, make it, note it, and continue.',
    '- "failed:" followed by the reason, when the task cannot be done as framed.',
  ].join("\n");
}

export interface BackgroundJobRecord {
  jobId: string;
  sessionId: string;
  title: string;
  scratchDir: string;
  status: BackgroundJobStatus;
  startedAt: number;
  endedAt?: number;
  headline?: string;
}

/** 一次作业运行的注入面：发送信封回合并回归宿主观察到的回复与错误旗标。 */
export interface BackgroundJobPorts {
  runJob(input: { sessionId: string; messageId: string; envelope: string }): Promise<{
    replyText: string;
    errored: boolean;
  }>;
  /** 终态通知（结构化；宿主格式化为用户文案）。失败不致命，走 onNotifyError。 */
  notify(payload: { jobTitle: string; outcome: BackgroundJobOutcome }): Promise<void> | void;
  onNotifyError?(error: unknown): void;
  now?(): number;
  log?(level: "info" | "warn" | "error", msg: string, data?: unknown): void;
}

export interface BackgroundJobStartInput {
  jobId: string;
  sessionId: string;
  title: string;
  scratchDir: string;
  prompt: string;
}

export interface BackgroundJobService {
  /** 运行一次作业至终态（同一作业一次运行；循环/重复仍属 4D 前台自动化）。 */
  start(input: BackgroundJobStartInput): Promise<BackgroundJobRecord>;
  list(): readonly BackgroundJobRecord[];
}

export function createBackgroundJobService(ports: BackgroundJobPorts): BackgroundJobService {
  const now = ports.now ?? Date.now;
  const records = new Map<string, BackgroundJobRecord>();
  return {
    async start(input) {
      const record: BackgroundJobRecord = {
        jobId: input.jobId,
        sessionId: input.sessionId,
        title: input.title,
        scratchDir: input.scratchDir,
        status: "working",
        startedAt: now(),
      };
      records.set(input.jobId, record);
      const messageId = `background_${input.jobId}_${now().toString(36)}`;
      const envelope = buildBackgroundJobTurn({
        title: input.title,
        scratchDir: input.scratchDir,
        prompt: input.prompt,
      });
      const reply = await ports.runJob({ sessionId: input.sessionId, messageId, envelope });
      const outcome = backgroundOutcomeOf(reply.replyText, reply.errored);
      record.status = outcome.status;
      record.endedAt = now();
      record.headline = outcome.headline;
      try {
        await ports.notify({ jobTitle: input.title, outcome });
      } catch (error) {
        ports.onNotifyError?.(error);
      }
      ports.log?.("info", "background job settled", {
        jobId: input.jobId,
        status: outcome.status,
      });
      return { ...record };
    },
    list: () => [...records.values()],
  };
}
