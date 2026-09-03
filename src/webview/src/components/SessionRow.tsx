// 会话行（侧栏共用）：运行态转圈 / 静态圆点 + 标题 + 相对时间。
// 悬停时时间原位让位于操作钮（内联，不再绝对定位——避免压住标题文字），超长
// 标题开始缓慢来回轮播（marquee-title，距离/时长按溢出量内联注入）；悬停
// 350ms 后出会话预览卡（最近一轮用户/助手文本，portal fixed 定位、rise-in
// 进场、pointer-events-none）。分组视图行另支持移动到顶部/移出分组与拖拽。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowUpToLine, LoaderCircle, X } from "lucide-react";
import type { Session } from "../../../shared/ipc";
import { messageText } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";
import { relativeTime } from "../lib/time";

/** 标题轮播：悬停激活后测量溢出距离；不超长/非悬停时保持 truncate（省略号）。 */
function MarqueeTitle({ text, active }: { text: string; active: boolean }): React.JSX.Element {
  const outerRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);
  useEffect(() => {
    if (!active) {
      setDistance(0);
      return;
    }
    const el = outerRef.current;
    if (el) setDistance(Math.max(0, el.scrollWidth - el.clientWidth));
  }, [active, text]);
  if (!active || distance <= 0) {
    return (
      <span ref={outerRef} className="min-w-0 flex-1 truncate">
        {text}
      </span>
    );
  }
  return (
    <span ref={outerRef} className="min-w-0 flex-1 overflow-hidden">
      <span
        className="marquee-title inline-block whitespace-nowrap"
        style={
          {
            "--marquee-x": `${-distance}px`,
            "--marquee-duration": `${Math.max(4, Math.round(distance / 25))}s`,
          } as React.CSSProperties
        }
      >
        {text}
      </span>
    </span>
  );
}

interface PreviewData {
  user: string;
  assistant: string;
}

/** 预览文本进程内缓存（允许轻微滞后，应用重启即刷新）。 */
const previewCache = new Map<string, PreviewData>();

/** 最近一轮：最后一条用户消息 + 最后一条助手消息的正文（各截 300 字）。 */
async function loadPreview(id: string): Promise<PreviewData | null> {
  const cached = previewCache.get(id);
  if (cached) return cached;
  const messages = await api.listMessages(id);
  let user = "";
  let assistant = "";
  for (let i = messages.length - 1; i >= 0 && (user === "" || assistant === ""); i -= 1) {
    const text = messageText(messages[i]!.parts).trim();
    if (text === "") continue;
    if (messages[i]!.role === "user" && user === "") user = text;
    if (messages[i]!.role === "assistant" && assistant === "") assistant = text;
  }
  if (user === "" && assistant === "") return null;
  const data: PreviewData = { user: user.slice(0, 300), assistant: assistant.slice(0, 300) };
  previewCache.set(id, data);
  return data;
}

/** 悬停预览卡：行右缘外侧、垂直对中并夹回视口；纯展示不接收指针。 */
function SessionPreviewCard({ preview, anchor }: { preview: PreviewData; anchor: DOMRect }): React.JSX.Element {
  const HALF_ESTIMATE = 110;
  const center = anchor.top + anchor.height / 2;
  const top = Math.min(Math.max(HALF_ESTIMATE + 8, center), window.innerHeight - HALF_ESTIMATE - 8);
  return (
    <div
      aria-hidden
      className="rise-in pointer-events-none fixed z-50 w-[340px] -translate-y-1/2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-3 shadow-(--shadow-pop)"
      style={{ left: anchor.right + 8, top }}
    >
      {preview.user !== "" && (
        <p className="line-clamp-3 text-[13px] leading-relaxed break-words text-(--color-foreground)">{preview.user}</p>
      )}
      {preview.assistant !== "" && (
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed break-words text-(--color-muted)">{preview.assistant}</p>
      )}
    </div>
  );
}

export function SessionRow({
  t,
  session,
  active,
  running,
  onSelect,
  onArchive,
  archiveLabel,
  onMoveToTop,
  onRemoveFromGroup,
  draggable = false,
}: {
  session: Session;
  active: boolean;
  running: boolean;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  archiveLabel: string;
  /** 动作条文案（分组视图传入；缺省时分组动作钮不渲染）。 */
  t?: (key: string) => string;
  /** 分组内行：移动到顶部。 */
  onMoveToTop?: (id: string) => void;
  /** 分组内行：移出分组（回未分组区）。 */
  onRemoveFromGroup?: (id: string) => void;
  /** 分组视图行可拖拽（拖到分组/未分组放置区移动归属）。 */
  draggable?: boolean;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<{ data: PreviewData; anchor: DOMRect } | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPreview = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPreview(null);
  };
  useEffect(() => cancelPreview, []);

  const handleEnter = (): void => {
    setHover(true);
    if (!hasBridge()) return;
    timerRef.current = setTimeout(() => {
      void loadPreview(session.id)
        .then((data) => {
          const anchor = rowRef.current?.getBoundingClientRect();
          if (data && anchor) setPreview({ data, anchor });
        })
        .catch(() => undefined);
    }, 350);
  };
  const handleLeave = (): void => {
    setHover(false);
    cancelPreview();
  };

  return (
    <li
      ref={rowRef}
      className="group flex h-[30px] items-center"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      draggable={draggable}
      onDragStart={
        draggable
          ? (event) => {
              // jsdom 无 dataTransfer；原生拖拽仅需携带会话 id。
              if (event.dataTransfer) {
                event.dataTransfer.setData("text/plain", session.id);
                event.dataTransfer.effectAllowed = "move";
              }
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        title={session.title}
        className={`flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left ${
          active
            ? "bg-(--color-selected) font-medium text-(--color-foreground-strong)"
            : "text-(--color-foreground) hover:bg-(--color-hover)"
        }`}
      >
        {running ? (
          <LoaderCircle aria-label="running" size={13} className="shrink-0 animate-spin text-(--color-accent)" />
        ) : (
          <span className="grid size-[13px] shrink-0 place-items-center rounded-full border border-(--color-border)" aria-hidden />
        )}
        <MarqueeTitle text={session.title} active={hover} />
      </button>
      {/* 常态时间；悬停原位换成操作钮（内联布局，不再绝对定位压字）。 */}
      <time
        className="shrink-0 pr-1.5 text-(--color-faint) group-hover:hidden"
        dateTime={new Date(session.updatedAt).toISOString()}
      >
        {relativeTime(session.updatedAt)}
      </time>
      <span className="hidden shrink-0 items-center gap-0.5 pr-1.5 group-hover:flex">
        <button
          type="button"
          aria-label={archiveLabel}
          title={archiveLabel}
          onClick={() => onArchive(session.id)}
          className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
        >
          <Archive size={13} />
        </button>
        {t && onMoveToTop && (
          <button
            type="button"
            aria-label={t("sidebar.group.moveToTop")}
            title={t("sidebar.group.moveToTop")}
            onClick={() => onMoveToTop(session.id)}
            className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
          >
            <ArrowUpToLine size={13} />
          </button>
        )}
        {t && onRemoveFromGroup && (
          <button
            type="button"
            aria-label={t("sidebar.group.remove")}
            title={t("sidebar.group.remove")}
            onClick={() => onRemoveFromGroup(session.id)}
            className="rounded p-0.5 text-(--color-muted) hover:text-(--color-foreground)"
          >
            <X size={13} />
          </button>
        )}
      </span>
      {preview && createPortal(<SessionPreviewCard preview={preview.data} anchor={preview.anchor} />, document.body)}
    </li>
  );
}
