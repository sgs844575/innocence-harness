// 左缘虚线刻度：9 段竖梯，垂直居中于聊天区左缘 12px，点击按比例跳转。
export function ChatDashes({
  fraction,
  onSeek,
}: {
  fraction: number;
  onSeek: (fraction: number) => void;
}): React.JSX.Element {
  const segments = 9;
  const active = Math.round(fraction * (segments - 1));
  return (
    <div className="flex flex-col items-center gap-[6px]" aria-hidden={false}>
      {Array.from({ length: segments }, (_, index) => (
        <button
          key={index}
          type="button"
          aria-label={`跳转到 ${Math.round((index / (segments - 1)) * 100)}%`}
          onClick={() => onSeek(index / (segments - 1))}
          className={`h-[14px] w-[2px] rounded-full transition-colors motion-reduce:transition-none ${
            index === active ? "bg-(--color-accent)" : "bg-(--color-border) hover:bg-(--color-muted)"
          }`}
        />
      ))}
    </div>
  );
}
