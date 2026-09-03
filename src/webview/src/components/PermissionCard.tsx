// 权限批准卡：工具调用需要确认时嵌在输入卡上方同轨道。
import type { ChatPermissionEvent, PermissionChoice } from "../../../shared/ipc";

export function PermissionCard({
  t,
  request,
  onRespond,
}: {
  t: (key: string) => string;
  request: ChatPermissionEvent;
  onRespond: (requestId: string, choice: PermissionChoice) => void;
}): React.JSX.Element {
  return (
    <div
      role="alertdialog"
      aria-label={t("permission.card.title")}
      className="rounded-(--radius-card) border border-(--color-border) bg-(--color-raised) p-3 shadow-(--shadow-card)"
    >
      <div className="font-medium text-(--color-foreground-strong)">{t("permission.card.title")}</div>
      <div className="mt-1 text-(--color-muted)">
        <span className="font-mono">{request.toolName}</span>
        <span className="ml-2 text-(--color-faint)">
          {request.resource.action} · {request.resource.scope}
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onRespond(request.requestId, "allow")}
          className="h-7 rounded-md bg-(--color-foreground-strong) px-3 text-(--color-background) hover:opacity-90"
        >
          {t("permission.card.allow")}
        </button>
        <button
          type="button"
          onClick={() => onRespond(request.requestId, "allowSession")}
          className="h-7 rounded-md border border-(--color-border) px-3 text-(--color-foreground) hover:bg-(--color-hover)"
        >
          {t("permission.card.allowSession")}
        </button>
        <button
          type="button"
          onClick={() => onRespond(request.requestId, "deny")}
          className="h-7 rounded-md border border-(--color-border) px-3 text-(--color-tool-err) hover:bg-(--color-hover)"
        >
          {t("permission.card.deny")}
        </button>
      </div>
    </div>
  );
}
