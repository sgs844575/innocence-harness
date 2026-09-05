import type { ReactNode } from "react";

export function BrowserAccess({ enabled, t, onOpenSettings, children }: {
  enabled: boolean;
  t: (key: string) => string;
  onOpenSettings: () => void;
  children: ReactNode;
}): React.JSX.Element {
  if (enabled) return <>{children}</>;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-(--color-muted)">
      <p>{t("settings.browser.disabled")}</p>
      <button type="button" onClick={onOpenSettings} className="rounded-md border border-(--color-border) px-3 py-1.5 text-(--color-foreground) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)">
        {t("settings.browser.openSettings")}
      </button>
    </div>
  );
}
