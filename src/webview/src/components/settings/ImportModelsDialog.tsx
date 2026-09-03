// 「导入模型」弹窗：拉取结果不直接写入，用户勾选要导入的模型，并统一下发
// 上下文窗口（默认 1000000）/ 最大输出（默认 128000）/ 输入类型（文本锁定，
// 图片、视频可勾选）/ 输出类型（文本锁定）。Esc/遮罩关闭。
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ModelInfo } from "../../../../shared/ipc";

interface Props {
  t: (key: string) => string;
  /** 待导入候选（已排除清单中已有的 id）。 */
  models: ModelInfo[];
  onClose: () => void;
  onImport: (models: ModelInfo[]) => void;
}

const field =
  "w-full rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 outline-none text-(--color-foreground) placeholder:text-(--color-faint) focus:border-(--color-accent)";
const label = "mb-1 block text-(--color-muted)";

export function ImportModelsDialog({ t, models, onClose, onImport }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(models.map((model) => model.id)));
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

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const importSelected = (): void => {
    const context = Number(contextWindow);
    const output = Number(maxOutput);
    const picked = models
      .filter((model) => selected.has(model.id))
      .map((model) => ({
        ...model,
        ...(Number.isFinite(context) && context > 0 ? { contextWindow: context } : {}),
        ...(Number.isFinite(output) && output > 0 ? { maxOutput: output } : {}),
        vision: vision || model.vision === true,
        video: video || model.video === true,
        // 用户在导入时确认的字段标记为手改，enrich 不再覆盖。
        dirty: true,
      }));
    if (picked.length > 0) onImport(picked);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" role="dialog" aria-label={t("settings.models.import.title")}>
      <button type="button" aria-label={t("settings.dialog.cancel")} onClick={onClose} className="absolute inset-0 cursor-default bg-black/25" />
      <div data-state="open" className="modal-in relative w-[440px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)">
        <div className="mb-4 flex items-center">
          <span className="font-bold text-(--color-foreground-strong)">{t("settings.models.import.title")}</span>
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

        <div className="scrollbar-thin max-h-48 space-y-1 overflow-y-auto rounded-md border border-(--color-hairline) bg-(--color-surface) p-1.5">
          {models.map((model) => (
            <label
              key={model.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-(--color-foreground) hover:bg-(--color-hover)"
            >
              <input
                type="checkbox"
                checked={selected.has(model.id)}
                onChange={() => toggle(model.id)}
                aria-label={model.id}
              />
              <span className="min-w-0 flex-1 truncate font-mono">{model.name ?? model.id}</span>
            </label>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>{t("settings.models.dialog.contextWindow")}</span>
            <input
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className={`${field} font-mono`}
            />
          </label>
          <label className="block">
            <span className={label}>{t("settings.models.dialog.maxOutput")}</span>
            <input
              value={maxOutput}
              onChange={(event) => setMaxOutput(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className={`${field} font-mono`}
            />
          </label>
        </div>

        <div className="mt-3">
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
        <div className="mt-3">
          <span className={label}>{t("settings.models.dialog.outputTypes")}</span>
          <span className="flex h-7 w-fit items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 text-(--color-faint)">
            <input type="checkbox" checked readOnly disabled aria-label={t("settings.models.dialog.text")} />
            {t("settings.models.dialog.text")}
          </span>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-(--color-border) px-3 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            {t("settings.dialog.cancel")}
          </button>
          <button
            type="button"
            onClick={importSelected}
            disabled={selected.size === 0}
            className="h-8 rounded-md bg-(--color-brand) px-3 text-(--color-inverse) transition-opacity hover:opacity-80 disabled:opacity-30"
          >
            {t("settings.models.import.action")}（{selected.size}）
          </button>
        </div>
      </div>
    </div>
  );
}
