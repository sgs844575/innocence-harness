// 「关于」对话框：logo + 应用名 + 版本。Esc/遮罩/X 关闭（AddModelDialog 同范式）。
import { useEffect } from "react";
import { X } from "lucide-react";
import logoUrl from "../../../../logo.svg";

interface Props {
  t: (key: string) => string;
  /** 应用版本（app:info）；缺省不显示版本行。 */
  version?: string;
  onClose: () => void;
}

export function AboutDialog({ t, version, onClose }: Props): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" role="dialog" aria-label={t("titlebar.appMenu.about")}>
      <button
        type="button"
        aria-label={t("settings.dialog.cancel")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/25"
      />
      <div
        data-state="open"
        className="modal-in relative w-[300px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-6 text-center shadow-(--shadow-pop)"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("settings.dialog.cancel")}
          title={t("settings.dialog.cancel")}
          className="absolute top-3 right-3 grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
        <img src={logoUrl} alt="" className="mx-auto size-12 rounded-xl" />
        <div className="mt-3 font-bold text-(--color-foreground-strong)">{t("app.name")}</div>
        {version && (
          <div className="mt-1 text-(--color-muted)">
            {t("about.version")} {version}
          </div>
        )}
      </div>
    </div>
  );
}
