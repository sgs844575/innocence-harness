// ChatDashes — 聊天滚动区左缘的虚线刻度（参考稿 chat-dashes 的功能化）：
// 垂直居中于滚动区、水平居中于左留白槽；每个刻度是一个按钮，点击按
// 比例跳转到对应历史位置，当前视口位置以强调色标注。
interface Props {
  /** 刻度数量（参考稿为 9）。 */
  count?: number;
  /** 当前滚动位置 0..1（顶部=0）。 */
  fraction: number;
  /** 按比例跳转（0=顶部，1=底部）。 */
  onSeek: (fraction: number) => void;
}

export function ChatDashes({ count = 9, fraction, onSeek }: Props): React.JSX.Element {
  const active = Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
  return (
    <nav
      aria-label="会话位置刻度"
      className="flex flex-col gap-[5px]"
      style={{ alignItems: "center" }}
    >
      {Array.from({ length: count }, (_, i) => {
        const target = count === 1 ? 0 : i / (count - 1);
        return (
          <button
            key={i}
            type="button"
            aria-label={`定位到 ${Math.round(target * 100)}%`}
            title={`定位到 ${Math.round(target * 100)}%`}
            onClick={() => onSeek(target)}
            className={`block h-[3px] w-3 rounded-[1.5px] transition-colors ${
              i === active ? "bg-(--color-app-accent)" : "bg-(--color-app-border) hover:bg-(--color-app-muted)"
            }`}
          />
        );
      })}
    </nav>
  );
}
