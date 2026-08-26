import { useEffect, useReducer, useRef, useState } from "react";
import type { ChatMessage, ChatPermissionEvent, HarnessSettings, PermissionChoice } from "../../../shared/ipc";
import { MessageItem, type ForkMessageCommand, type TaskChangeCardCommand } from "./MessageItem";
import { Composer } from "./Composer";
import { PermissionCard } from "./PermissionCard";
import { ProjectPicker, type RecentProject } from "./composer/ProjectPicker";
import { ConversationHeader } from "./chat/ConversationHeader";
import { AgentActivityCapsule } from "./context-capsule/AgentActivityCapsule";
import type { AgentActivityProjection } from "./context-capsule/activityProjection";
import { CAPSULE_WIDTH, defaultWorkspacePresentationState, reduceWorkspacePresentationState, workspaceLayoutForWidth } from "../state/workspacePresentationState";

interface Props {
  t: (key: string) => string;
  appName: string;
  taskTitle?: string;
  projectName?: string;
  gitBranch?: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  settings: HarnessSettings | null;
  permission: ChatPermissionEvent | null;
  onSettingsChange: (patch: Partial<HarnessSettings>) => void;
  onPermissionRespond: (requestId: string, choice: PermissionChoice) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** 落地态（无激活会话）：输入面板垂直居中 + 顶部项目选择行。 */
  landing: boolean;
  /** 落地态选中的项目（"" = 不在项目中）。 */
  pendingProject: string;
  onPickProject: (workspaceRoot: string) => void;
  recentProjects: RecentProject[];
  /** 「打开项目…」系统目录选择器（结果进落地态选择，不直接改全局）。 */
  onOpenProjectDir: () => void;
  /** 消息内任务变更卡（按消息 id 索引）；Task 12 接 IPC view model，缺省不渲染。 */
  taskChanges?: Record<string, TaskChangeCardCommand>;
  /** 「审查」动作——打开任务审查面板；缺省为 no-op（按钮禁用）。 */
  onOpenTaskReview?: (messageId: string) => void;
  /** 消息级分叉入口（编辑并创建路线 / 重试并创建路线）；缺省不渲染按钮。 */
  onForkMessage?: (command: ForkMessageCommand) => void;
  /** Opens the existing typed Review panel from the header action. */
  onOpenReview?: () => void;
  /** Existing domain/runtime state projected for the right activity capsule. */
  activity?: AgentActivityProjection;
}

export function ChatView({
  t,
  appName,
  messages,
  streaming,
  settings,
  permission,
  onSettingsChange,
  onPermissionRespond,
  onSend,
  onStop,
  landing,
  pendingProject,
  onPickProject,
  recentProjects,
  onOpenProjectDir,
  taskChanges,
  onOpenTaskReview,
  onForkMessage,
  onOpenReview,
  taskTitle,
  projectName,
  gitBranch,
  activity,
}: Props): React.JSX.Element {
  const [presentation, dispatchPresentation] = useReducer(reduceWorkspacePresentationState, defaultWorkspacePresentationState);
  const [availableWidth, setAvailableWidth] = useState(() => typeof window === "undefined" ? 1024 : window.innerWidth);
  const layout = workspaceLayoutForWidth(availableWidth);
  const hasDockedCapsule = layout.capsulePlacement === "docked" && activity !== undefined;
  // The companion track remains outside the reading column when collapsed, so
  // messages and Composer never shift or narrow as the capsule disclosure changes.
  const companionWidth = hasDockedCapsule ? CAPSULE_WIDTH : 0;
  const companionGap = hasDockedCapsule ? layout.capsuleGap : 0;
  const frameMaxWidth = layout.contentMaxWidth + companionGap + companionWidth;
  const workspaceRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 贴底策略：用户上滚（scrollTop 减小）→ 暂停跟随；回到底部（距底 <48px）→ 恢复。
  // 判定必须带方向：smooth 跟随动画期间流式内容长高，中途帧距底会 >48px，
  // 纯距离判定会把程序滚动误判成用户上滚使 pinned 自锁为 false；而向下滚动
  // （含程序动画）不会让 scrollTop 减小，方向判定天然免疫，对惯性/回弹也稳健。
  const [pinned, setPinned] = useState(true);
  const lastScrollTop = useRef(0);
  // 引用通道：操作栏「引用」把文本塞进 Composer，Composer 消费后回调清空。
  const [quoteDraft, setQuoteDraft] = useState("");

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(([entry]) => {
        if (entry?.contentRect.width > 0) setAvailableWidth(entry.contentRect.width);
      });
      observer.observe(workspace);
      return () => observer.disconnect();
    }
    const onResize = () => setAvailableWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [landing]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    const wentUp = el.scrollTop < lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if (wentUp && !atBottom) setPinned(false);
    else if (atBottom) setPinned(true);
  };

  useEffect(() => {
    if (!pinned) return;
    // 流式期间必须瞬时贴底：smooth 动画的终点是"动画开始时的底部"，
    // 而流式内容在动画窗口内持续增长，动画永远追不上 → 视口总差一点。
    // 瞬时滚动每次都精确落底；非流式变化（切会话/首载）保留 smooth 手感。
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth", block: "end" });
  }, [messages, pinned, streaming]);

  // 落地态（无激活会话）：输入面板垂直居中 + 顶部项目选择行；不渲染消息区。
  if (landing) {
    return (
      <main ref={workspaceRef} className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center pb-24" style={{ paddingInline: layout.contentGutter }}>
          <div className="w-full" style={{ maxWidth: layout.contentMaxWidth }}>
            <h1 className="mb-4 text-center text-[clamp(17px,2vw,21px)] font-medium">
              {t("chat.empty.title").replace("InnocenceHarness", appName)}
            </h1>
            <Composer
              t={t}
              mode="landing"
              streaming={streaming}
              settings={settings}
              onSettingsChange={onSettingsChange}
              onSend={onSend}
              onStop={onStop}
              contentMaxWidth={layout.contentMaxWidth}
              contentGutter={0}
              frameMaxWidth={layout.contentMaxWidth}
              header={
                <ProjectPicker
                  t={t}
                  value={pendingProject}
                  recent={recentProjects}
                  onSelect={onPickProject}
                  onOpenProject={onOpenProjectDir}
                />
              }
            />
          </div>
        </div>
      </main>
    );
  }

  const title = taskTitle ?? "当前会话";
  const capsule = activity ? (
    <AgentActivityCapsule
      open={presentation.capsuleOpen}
      onToggleOpen={() => dispatchPresentation({ type: "capsule/toggle" })}
      expandedSections={presentation.expandedCapsuleSections}
      onToggleSection={(section) => dispatchPresentation({ type: "capsule/toggle-section", section })}
      environment={activity.environment}
      process={activity.process}
      terminal={activity.terminal}
      agent={activity.agent}
      placement={layout.capsulePlacement}
    />
  ) : null;

  return (
    <main
      ref={workspaceRef}
      className={`chat-workspace chat-workspace-${layout.capsulePlacement} flex h-full min-w-0 flex-1 flex-col`}
    >
      <ConversationHeader task={title} project={projectName ?? ""} branch={gitBranch ?? null} actions={onOpenReview ? [{ label: "打开审查", onSelect: onOpenReview }] : []} />
      <div className="chat-workspace-body min-h-0 flex-1" style={{ paddingInline: layout.contentGutter }}>
        <div className="relative mx-auto flex h-full min-h-0 w-full" style={{ maxWidth: frameMaxWidth, gap: companionGap }}>
          <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
            <div data-testid="chat-timeline" className="chat-column mx-auto pb-6" style={{ maxWidth: layout.contentMaxWidth }}>
              <div className="space-y-5 pt-6">
                {messages.map((m) => (
                  <MessageItem
                    key={m.id}
                    t={t}
                    message={m}
                    isLatest={m.id === messages[messages.length - 1]?.id}
                    onQuote={setQuoteDraft}
                    onForkMessage={onForkMessage}
                    taskChange={taskChanges?.[m.id]}
                    onOpenTaskReview={onOpenTaskReview ? () => onOpenTaskReview(m.id) : undefined}
                  />
                ))}
              </div>
              <div ref={bottomRef} />
            </div>
          </div>
          {hasDockedCapsule ? (
            <div data-testid="chat-capsule-slot" className="relative shrink-0" style={{ width: companionWidth }}>
              {capsule}
            </div>
          ) : capsule}
        </div>
      </div>

      {permission && (
        <div style={{ paddingInline: layout.contentGutter }}>
          <div className="mx-auto flex w-full" style={{ maxWidth: frameMaxWidth, gap: companionGap }}>
            <div className="chat-column" style={{ maxWidth: layout.contentMaxWidth }}>
              <PermissionCard t={t} request={permission} onRespond={onPermissionRespond} />
            </div>
            {companionWidth > 0 && <div aria-hidden="true" className="shrink-0" style={{ width: companionWidth }} />}
          </div>
        </div>
      )}

      <Composer
        t={t}
        mode="existing"
        contextCount={0}
        contentMaxWidth={layout.contentMaxWidth}
        contentGutter={layout.contentGutter}
        frameMaxWidth={frameMaxWidth}
        companionWidth={companionWidth}
        companionGap={companionGap}
        streaming={streaming}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onSend={onSend}
        onStop={onStop}
        initialText={quoteDraft}
        onConsumed={() => setQuoteDraft("")}
      />
    </main>
  );
}
