// 「添加模型」弹窗（对齐参考）：模型 ID + 上下文窗口 + 最大输出 Token +
// 输入类型（文本锁定、图片→vision）。Esc/遮罩关闭，保存后回调 ModelInfo。
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ModelInfo } from "../../../../shared/ipc";

interface Props {
  t: (key: string) => string;
  onClose: () => void;
  onSave: (model: ModelInfo) => void;
}

export function AddModelDialog({ t, onClose, onSave }: Props): React.JSX.Element {
  const [id, setId] = useState("");
  const [contextWindow, setContextWindow] = useState("1000000");
  const [maxOutput, setMaxOutput] = useState("128000");
  const [vision, setVision] = useState(false);
  const [video, setVideo] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const save = (): void => {
    const modelId = id.trim();
    if (!modelId) return;
    const context = Number(contextWindow);
    const output = Number(maxOutput);
    onSave({
      id: modelId,
      name: modelId,
      source: "manual",
      ...(contextWindow.trim() !== "" && Number.isFinite(context) && context > 0 ? { contextWindow: context } : {}),
      ...(maxOutput.trim() !== "" && Number.isFinite(output) && output > 0 ? { maxOutput: output } : {}),
      ...(vision ? { vision: true } : {}),
      ...(video ? { video: true } : {}),
      dirty: true,
    });
  };

  const field = "w-full rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 outline-none text-(--color-foreground) placeholder:text-(--color-faint) focus:border-(--color-accent)";
  const label = "mb-1 block text-(--color-muted)";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" role="dialog" aria-label={t("settings.models.dialog.title")}>
      <button type="button" aria-label={t("settings.dialog.cancel")} onClick={onClose} className="absolute inset-0 cursor-default bg-black/25" />
      <div data-state="open" className="modal-in relative w-[400px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)">
        <div className="mb-4 flex items-center">
          <span className="font-bold text-(--color-foreground-strong)">{t("settings.models.dialog.title")}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("settings.dialog.cancel")}
            title={t("settings.dialog.cancel")}
            className="ml-auto grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <X size={14} />
          </button>
        </div>

        <label className="mb-3 block">
          <span className={label}>{t("settings.models.dialog.modelId")}</span>
          <input
            autoFocus
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder={t("settings.models.dialog.modelId")}
            className={`${field} font-mono`}
          />
        </label>
        <label className="mb-3 block">
          <span className={label}>{t("settings.models.dialog.contextWindow")}</span>
          <input
            value={contextWindow}
            onChange={(event) => setContextWindow(event.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={`${field} font-mono`}
          />
        </label>
        <label className="mb-3 block">
          <span className={label}>{t("settings.models.dialog.maxOutput")}</span>
          <input
            value={maxOutput}
            onChange={(event) => setMaxOutput(event.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={`${field} font-mono`}
          />
        </label>

        <div className="mb-3">
          <span className={label}>{t("settings.models.dialog.inputTypes")}</span>
          <div className="flex gap-2">
            <span className="flex h-7 items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 text-(--color-faint)">
              <input type="checkbox" checked readOnly disabled aria-label={t("settings.models.dialog.text")} />
              {t("settings.models.dialog.text")}
            </span>
            {([
              { key: "image" as const, checked: vision, set: setVision },
              { key: "video" as const, checked: video, set: setVideo },
            ]).map(({ key, checked, set }) => (
              <label
                key={key}
                className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 text-(--color-foreground) hover:bg-(--color-hover)"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => set(event.target.checked)}
                  aria-label={t(`settings.models.dialog.${key}`)}
                />
                {t(`settings.models.dialog.${key}`)}
              </label>
            ))}
          </div>
        </div>
        <div className="mb-5">
          <span className={label}>{t("settings.models.dialog.outputTypes")}</span>
          <span className="flex h-7 w-fit items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 text-(--color-faint)">
            <input type="checkbox" checked readOnly disabled aria-label={t("settings.models.dialog.text")} />
            {t("settings.models.dialog.text")}
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-(--color-border) px-3 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            {t("settings.dialog.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={id.trim() === ""}
            className="h-8 rounded-md bg-(--color-brand) px-3 text-(--color-inverse) transition-opacity hover:opacity-80 disabled:opacity-30"
          >
            {t("settings.models.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
