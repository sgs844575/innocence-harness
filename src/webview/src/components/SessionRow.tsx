// 会话行（侧栏共用）：运行态转圈 / 置顶 Pin / 静态圆点 + 标题 + 相对时间。
// 悬停时时间原位让位于操作钮（内联，不再绝对定位——避免压住标题文字），超长
// 标题开始缓慢来回轮播（marquee-title，距离/时长按溢出量内联注入）。
// 分组视图行另支持移动到顶部/移出分组与拖拽。
import { useEffect, useRef, useState } from "react";
import { Archive, ArrowUpToLine, LoaderCircle, Pin, X } from "lucide-react";
import type { Session } from "../../../shared/ipc";
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

export function SessionRow({
  t,
  session,
  active,
  running,
  pinned = false,
  unread = false,
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
  /** 置顶会话：行首静态圆点换成 Pin 图标（运行态转圈优先）。 */
  pinned?: boolean;
  unread?: boolean;
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

  return (
    <li
      className={`group flex h-8 min-w-0 items-center rounded-[calc(var(--radius-pop)/2)] transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) motion-reduce:transition-none ${
        active ? "bg-(--color-selected)" : "hover:bg-(--color-hover)"
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
        aria-current={active ? "page" : undefined}
        className={`flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left ${
          active
            ? "font-medium text-(--color-foreground-strong)"
            : "text-(--color-foreground)"
        }`}
      >
        {running ? (
          <LoaderCircle aria-label="running" size={13} className="shrink-0 animate-spin text-(--color-accent)" />
        ) : pinned ? (
          <Pin
            size={13}
            className={`shrink-0 ${active ? "text-(--color-accent)" : "text-(--color-muted)"}`}
            aria-hidden
          />
        ) : (
          <span className="grid size-[13px] shrink-0 place-items-center" aria-hidden>
            <span
              className={`size-1.5 rounded-full ${
                active || unread ? "bg-(--color-accent)" : "bg-(--color-faint)"
              }`}
            />
          </span>
        )}
        <MarqueeTitle text={session.title} active={hover} />
      </button>
      {/* 常态时间；悬停原位换成操作钮（内联布局，不再绝对定位压字）。 */}
      <time
        className="mr-2 shrink-0 text-[12px] leading-none tabular-nums text-(--color-faint) group-hover:hidden"
        dateTime={new Date(session.updatedAt).toISOString()}
      >
        {relativeTime(session.updatedAt)}
      </time>
      <span className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          aria-label={archiveLabel}
          title={archiveLabel}
          onClick={() => onArchive(session.id)}
          className="grid size-5 place-items-center rounded-[calc(var(--radius-pop)/2)] text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <Archive size={13} />
        </button>
        {t && onMoveToTop && (
          <button
            type="button"
            aria-label={t("sidebar.group.moveToTop")}
            title={t("sidebar.group.moveToTop")}
            onClick={() => onMoveToTop(session.id)}
            className="grid size-5 place-items-center rounded-[calc(var(--radius-pop)/2)] text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
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
            className="grid size-5 place-items-center rounded-[calc(var(--radius-pop)/2)] text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <X size={13} />
          </button>
        )}
      </span>
    </li>
  );
}
