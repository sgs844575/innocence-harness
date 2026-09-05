// 会话页：消息时间线 + 左缘虚线刻度 + 右上 Git 浮动面板 + 底部输入卡；
// 中断的末条助手消息带「继续」图标钮；上滚脱离贴底时出回到底部钮；发送即回贴底。
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { ChatMessage, ChatContextUsageSnapshot, ChatPermissionEvent, ChatQuestionEvent, ChatQuestionResponse, HarnessSettings, PermissionChoice } from "../../../shared/ipc";
import { MessageItem } from "./MessageItem";
import { Composer } from "./Composer";
import { PermissionCard } from "./PermissionCard";
import { QuestionCard } from "./QuestionCard";
import { GitCapsule, type GitCapsuleData } from "./GitCapsule";
import { ChatDashes } from "./chat/ChatDashes";
import { WaitingRow } from "./chat/WaitingRow";
import { capsuleHasContent, capsuleRightGutter, CAPSULE_SQUEEZE_MIN_WIDTH } from "./chat/chatLayout";
import { streamDisplayFromSettings } from "./chat/toolGrouping";
import type { ToolRowModel } from "./chat/toolRows";
import type { TaskRowClue } from "../state/subagentRuns";
import { DEFAULT_CODE_THEME_DARK, DEFAULT_CODE_THEME_LIGHT } from "../../../shared/codeThemes";

// 内容列宽度：默认 896px（max-w-4xl）；宽窗分档放宽，最大化时不显窄——
// 视口 ≥1280 放宽到 1024（5xl），≥1536 放宽到 1152（6xl）。三处共用保持一致。
const columnClass = "mx-auto w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl";

interface Props {
  t: (key: string) => string;
  messages: ChatMessage[];
  streaming: boolean;
  permission: ChatPermissionEvent | null;
  question: ChatQuestionEvent | null;
  settings: HarnessSettings | null;
  onPatchSettings: (patch: Partial<HarnessSettings>) => void;
  onSend: (text: string) => void;
  /** 会话项目根（输入卡 @ 文件补全数据源）。 */
  workspaceRoot?: string;
  /** 编辑重发（替换语义）：截断 messageId 起的消息并以新文本重开一轮。 */
  onEditResend: (messageId: string, text: string) => void;
  onStop: () => void;
  onPermissionRespond: (requestId: string, choice: PermissionChoice) => void;
  /** 询问卡作答（null = 跳过）。 */
  onQuestionRespond: (requestId: string, response: ChatQuestionResponse) => void;
  capsule: GitCapsuleData;
  onManageModels?: () => void;
  /** 子代理工具行：在右侧面板中查看该次运行（载荷含关联键/标题/结果文本，
   *  无法唯一确定时落归档列表）。 */
  onOpenSubagent?: (clue: TaskRowClue) => void;
  /** 文件工具行：文件簇点击在右侧 dock 打开文件标签。 */
  onOpenFile?: (row: ToolRowModel) => void;
  /** 底部终端面板（顶栏终端钮开合；挂在输入卡之后，聊天列全宽）。 */
  terminalPanel?: React.ReactNode;
  /** 上下文容量快照（App 从 useChatStream 透传；输入卡常显环 + 明细弹层）。 */
  contextUsage?: ChatContextUsageSnapshot | null;
}

export function ChatView({
  t,
  messages,
  streaming,
  permission,
  question,
  settings,
  onPatchSettings,
  onSend,
  workspaceRoot = "",
  onEditResend,
  onStop,
  onPermissionRespond,
  onQuestionRespond,
  capsule,
  onManageModels,
  onOpenSubagent,
  onOpenFile,
  terminalPanel,
  contextUsage,
}: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 胶囊开合（受控）：展开时按胶囊尺寸挤压内容列，宽度不够则不挤。
  // 阈值（1280px，对齐参考容器断点）两侧自动开合：窄窗收成芯片、宽窗展开面板；
  // 阈值不变时用户手动开关保持有效。
  const [capsuleOpen, setCapsuleOpen] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  // 胶囊默认不出现：Git 仓库/待办/智能体/终端任一成立才显示，不显示时不挤压内容列。
  const capsuleShown = capsuleHasContent(capsule);
  const rightGutter = capsuleShown ? capsuleRightGutter(containerWidth, capsuleOpen) : 0;
  const squeezedRef = useRef<boolean | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => {
      if (width <= 0) return;
      setContainerWidth(width);
      const squeezed = width >= CAPSULE_SQUEEZE_MIN_WIDTH;
      if (squeezedRef.current !== squeezed) {
        squeezedRef.current = squeezed;
        setCapsuleOpen(squeezed);
      }
    };
    apply(body.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => apply(entry?.contentRect.width ?? 0));
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  // 贴底策略：用户上滚（scrollTop 减小）→ 暂停跟随；回到底部（距底 <48px）→ 恢复。
  const [pinned, setPinned] = useState(true);
  const lastScrollTop = useRef(0);
  const [scrollFraction, setScrollFraction] = useState(0);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    const wentUp = el.scrollTop < lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if (wentUp && !atBottom) setPinned(false);
    else if (atBottom) setPinned(true);
    const range = el.scrollHeight - el.clientHeight;
    setScrollFraction(range > 0 ? Math.min(1, Math.max(0, el.scrollTop / range)) : 0);
  };

  const seekTo = (fraction: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const range = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: fraction * range, behavior: "smooth" });
  };

  // 贴底滚动直达内容真底部（scrollHeight 含列的 pb-8；scrollIntoView 依赖
  // 锚点位置，曾被列 padding 截留 32px）。pinnedRef 供 ResizeObserver 闭包读取。
  const scrollToBottom = (behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  useEffect(() => {
    if (!pinned) return;
    // 流式期间瞬时贴底：smooth 动画追不上持续增长的内容。
    scrollToBottom(streaming ? "auto" : "smooth");
  }, [messages, pinned, streaming]);

  // 不改变 messages 引用的高度增长（异步代码高亮、等待行显隐等）同样跟随到底。
  useEffect(() => {
    const column = scrollRef.current?.firstElementChild;
    if (!column || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom("auto");
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  // 中断检测：末轮助手消息无完成元数据且不在流式 → 该消息挂「继续」图标钮。
  const showContinue = useMemo(() => {
    if (streaming || permission || question || messages.length === 0) return false;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]!;
      if (message.role !== "assistant") continue;
      return message.streaming !== true && message.completion == null;
    }
    return false;
  }, [messages, streaming, permission, question]);

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "assistant") return messages[i]!.id;
    }
    return null;
  }, [messages]);
  const latestUserId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "user") return messages[i]!.id;
    }
    return null;
  }, [messages]);

  // 发送（含「继续」）一律回到贴底跟随；编辑重发同样回贴底。
  const handleSend = (text: string): void => {
    setPinned(true);
    requestAnimationFrame(() => scrollToBottom("auto"));
    onSend(text);
  };

  const handleEditResend = (messageId: string, text: string): void => {
    setPinned(true);
    requestAnimationFrame(() => scrollToBottom("auto"));
    onEditResend(messageId, text);
  };

  // 外观设置 → 代码块高亮主题对与行号开关。
  const codeAppearance = {
    light: settings?.codeThemeLight ?? DEFAULT_CODE_THEME_LIGHT,
    dark: settings?.codeThemeDark ?? DEFAULT_CODE_THEME_DARK,
    lineNumbers: settings?.codeLineNumbers !== false,
  };
  // 消息流显示开关（思考/todo/工具分组）。
  const streamDisplay = streamDisplayFromSettings(settings);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div ref={bodyRef} className="relative min-h-0 flex-1">
        {messages.length > 0 && (
          <div className="absolute left-[12px] top-1/2 z-[5] -translate-y-1/2">
            <ChatDashes fraction={scrollFraction} onSeek={seekTo} />
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="scrollbar-thin h-full min-w-0 overflow-y-auto"
          style={{ paddingLeft: 24, paddingRight: 24 + rightGutter }}
        >
          <div data-testid="chat-timeline" className={`${columnClass} pb-8`}>
            {/* 首内容顶部留白 56px（参考 turn 的 pt-14）：避开右上悬浮的
                胶囊/芯片，窄窗下用户气泡不被遮盖。 */}
            <div className="space-y-5 pt-14">
              {messages.map((message) => (
                <MessageItem
                  key={message.id}
                  t={t}
                  message={message}
                  canEdit={!streaming && message.id === latestUserId}
                  onEditSend={
                    message.role === "user" ? (text) => handleEditResend(message.id, text) : undefined
                  }
                  continuable={showContinue && message.id === lastAssistantId}
                  onContinue={() => handleSend(t("chat.continue.prompt"))}
                  code={codeAppearance}
                  stream={streamDisplay}
                  onOpenSubagent={onOpenSubagent}
                  onOpenFile={onOpenFile}
                />
              ))}
              {/* 流式等待行：转圈 + 轮换耐心等待提示，位于时间线最底部。 */}
              {streaming && <WaitingRow t={t} />}
            </div>
          </div>
        </div>
        {capsuleShown && <GitCapsule t={t} data={capsule} open={capsuleOpen} onToggleOpen={setCapsuleOpen} />}
        {!pinned && (
          <button
            type="button"
            aria-label={t("chat.backToBottom")}
            title={t("chat.backToBottom")}
            onClick={() => {
              setPinned(true);
              scrollToBottom("smooth");
            }}
            // 会话列在扣除胶囊右侧边距后的内容盒内居中（内容盒中心 = 50% − 边距/2），
            // 按钮须对齐会话中心而非整个容器中心，否则胶囊开启时按钮偏右半个边距。
            style={{ left: `calc(50% - ${rightGutter / 2}px)` }}
            className="dropdown-in origin-bottom absolute bottom-4 z-[5] grid size-8 -translate-x-1/2 place-items-center rounded-full border border-(--color-border) bg-(--color-raised) text-(--color-muted) shadow-(--shadow-pop) hover:text-(--color-foreground)"
            data-state="open"
          >
            <ArrowDown size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {(permission || question) && (
        <div className="shrink-0 space-y-2 pb-2" style={{ paddingLeft: 24, paddingRight: 24 + rightGutter }}>
          <div className={columnClass}>
            {permission && (
              <PermissionCard t={t} request={permission} onRespond={onPermissionRespond} />
            )}
            {question && (
              <QuestionCard key={question.requestId} t={t} request={question} onRespond={onQuestionRespond} />
            )}
          </div>
        </div>
      )}

      <div className="shrink-0 pb-[clamp(10px,1.5vw,16px)]" style={{ paddingLeft: 24, paddingRight: 24 + rightGutter }}>
        <div className={columnClass}>
          <Composer
            t={t}
            mode="existing"
            streaming={streaming}
            settings={settings}
            onPatchSettings={onPatchSettings}
            onSend={handleSend}
            onStop={onStop}
            workspaceRoot={workspaceRoot}
            onManageModels={onManageModels}
            contextUsage={contextUsage}
          />
        </div>
      </div>

      {terminalPanel}
    </div>
  );
}
