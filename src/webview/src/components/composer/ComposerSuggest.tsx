// 补全弹层面板（@ 文件 / / 技能共用）：整卡同宽、悬于输入卡上方的浮动面板
// 家族表面（popup 色 + 12px 圆角 + 发丝边 + dropdown-in）。键盘活动行高亮并
// 随滚动进视口，aria listbox/option 供 textarea 的 aria-activedescendant 引用。
import { useEffect } from "react";
import { FileText, Zap } from "lucide-react";

/** 一条补全行：insert 是采纳时写入的载荷（技能名 / 相对路径）。 */
export interface SuggestRow {
  key: string;
  title: string;
  sub?: string;
  insert: string;
}

interface Props {
  t: (key: string) => string;
  kind: "slash" | "at";
  /** 空数组 + loading=false 时按状态行渲染（无项目 / 无匹配）。 */
  rows: SuggestRow[];
  loading: boolean;
  /** at 专用：未绑定项目时的提示态（优先于 loading/empty）。 */
  noWorkspace: boolean;
  activeIndex: number;
  listboxId: string;
  onHover: (index: number) => void;
  onAccept: (index: number) => void;
}

/** 状态行（加载中/无匹配/无项目）。 */
function StateRow({ text }: { text: string }): React.JSX.Element {
  return <div className="px-3 py-3 text-center text-(--color-muted)">{text}</div>;
}

export function ComposerSuggest({
  t,
  kind,
  rows,
  loading,
  noWorkspace,
  activeIndex,
  listboxId,
  onHover,
  onAccept,
}: Props): React.JSX.Element {
  // 键盘活动行随导航滚进视口（aria-activedescendant 不触发容器滚动）。
  useEffect(() => {
    document.getElementById(`${listboxId}-opt-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, listboxId]);
  const state = noWorkspace && kind === "at"
    ? t("composer.suggest.noWorkspace")
    : loading
      ? t("composer.suggest.loading")
      : rows.length === 0
        ? t("composer.suggest.empty")
        : null;
  return (
    <div
      role="listbox"
      aria-label={t(kind === "slash" ? "composer.suggest.skills" : "composer.suggest.files")}
      id={listboxId}
      data-state="open"
      className="dropdown-in absolute inset-x-0 bottom-full z-30 mb-2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1 shadow-(--shadow-pop)"
    >
      <div className="px-2.5 pb-1 pt-1.5 font-semibold uppercase tracking-wider text-(--color-muted)/70">
        {t(kind === "slash" ? "composer.suggest.skills" : "composer.suggest.files")}
      </div>
      <div className="scrollbar-thin max-h-72 overflow-y-auto">
        {state !== null ? (
          <StateRow text={state} />
        ) : (
          rows.map((row, index) => (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              id={`${listboxId}-opt-${index}`}
              // preventDefault 保 textarea 焦点（click 才是采纳动作）。
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onAccept(index)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${
                index === activeIndex ? "bg-(--color-hover)" : ""
              }`}
            >
              {kind === "slash" ? (
                <Zap size={13} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" />
              ) : (
                <FileText size={13} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px] text-(--color-foreground)">{row.title}</span>
                {row.sub && (
                  <span
                    className={`block truncate text-(--color-faint) ${kind === "at" ? "font-mono text-[12px]" : ""}`}
                  >
                    {row.sub}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
