// 附件 chip 展示（输入卡草稿区与用户气泡共用）：图像走内容协议直显
//（innocenceharness-content://obj/<key>），其余类型文件 chip（图标 + 名称）。
import { FileText, X } from "lucide-react";
import type { AttachmentDraftDto, AttachmentPart } from "../../../../shared/ipc";

/** 内容协议直显 URL（键形态已在主进程校验）。 */
export function contentUrl(key: string): string {
  return `innocenceharness-content://obj/${key}`;
}

/** 附件的首个图像表示键（气泡缩略直显用；无图像表示返回 undefined）。 */
export function imagePreviewKey(part: AttachmentPart): string | undefined {
  return part.representations.find((representation) => representation.kind === "image")?.content.key;
}

/** 用户气泡里的附件条：图像缩略 + 文件 chip。 */
export function AttachmentStrip({ parts }: { parts: readonly AttachmentPart[] }): React.JSX.Element | null {
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {parts.map((part) => {
        const imageKey = imagePreviewKey(part);
        if (imageKey !== undefined) {
          return (
            <img
              key={part.source.key}
              src={contentUrl(imageKey)}
              alt={part.name}
              className="max-h-40 max-w-64 rounded-lg border border-(--color-border) object-contain"
            />
          );
        }
        return (
          <span
            key={part.source.key}
            className="flex items-center gap-1.5 rounded-lg border border-(--color-border) bg-(--color-raised) px-2 py-1 text-[12px] text-(--color-foreground)"
          >
            <FileText size={12} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" />
            <span className="max-w-48 truncate">{part.name}</span>
          </span>
        );
      })}
    </div>
  );
}

/** 输入卡草稿 chip：缩略图/图标 + 名称 + 警告角标 + 移除钮。 */
export function AttachmentChip({
  draft,
  onRemove,
  removeLabel,
}: {
  draft: AttachmentDraftDto;
  onRemove: () => void;
  removeLabel: string;
}): React.JSX.Element {
  const thumbnail = draft.preview.kind === "image" ? draft.preview.thumbnailKey : undefined;
  const warning = draft.warnings.join("；");
  return (
    <span
      className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[12px] ${
        warning ? "border-(--color-border-hover)" : "border-(--color-border)"
      } bg-(--color-raised) text-(--color-foreground)`}
      title={warning || draft.part.name}
    >
      {thumbnail ? (
        <img src={contentUrl(thumbnail)} alt="" className="size-6 shrink-0 rounded object-cover" />
      ) : (
        <FileText size={13} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" />
      )}
      <span className="max-w-40 truncate">{draft.part.name}</span>
      {warning && <span className="shrink-0 text-(--color-mode-accent)">!</span>}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className="grid size-4 shrink-0 place-items-center rounded text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
      >
        <X size={11} strokeWidth={2} />
      </button>
    </span>
  );
}
