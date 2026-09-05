import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { HarnessSettings } from "../../../../shared/ipc";
import type { HarnessSettingsPatch } from "../../../../shared/settingsPatch";
import type { BrowserDataKind, BrowserDataResult } from "../../../../shared/browserIpc";
import { Switch } from "../ui/Switch";
import { SettingsRow } from "./rows";

const card = "divide-y divide-(--color-border) overflow-hidden rounded-(--radius-pop) border border-(--color-border) bg-(--color-raised)";
const button = "inline-flex h-8 min-w-24 shrink-0 items-center justify-center rounded-md px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) disabled:cursor-not-allowed disabled:opacity-45";
const secondary = `${button} border border-(--color-border) text-(--color-foreground) hover:bg-(--color-hover)`;
const destructive = `${button} bg-(--color-tool-err) text-(--color-neutral-50) hover:opacity-85`;

interface Props {
  t: (key: string) => string;
  settings: HarnessSettings | null;
  onPatchSettings: (patch: HarnessSettingsPatch) => void | Promise<void>;
  onClearData?: (kind: BrowserDataKind) => Promise<BrowserDataResult>;
}

export function BrowserPanel({ t, settings, onPatchSettings, onClearData }: Props): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const locked = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const perform = async (key: string, action: () => void | Promise<void>, success?: string): Promise<void> => {
    if (locked.current) return;
    locked.current = true;
    setBusy(key);
    setNotice(null);
    try {
      await action();
      if (success) setNotice({ text: t(success), error: false });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setNotice({ text: `${t("settings.browser.failed")} ${detail}`, error: true });
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };

  const clear = (kind: BrowserDataKind): void => {
    if (!onClearData) return;
    setConfirmOpen(false);
    void perform(kind, async () => {
      const result = await onClearData(kind);
      if (!result.ok) throw new Error(result.error);
    }, kind === "cache" ? "settings.browser.cacheCleared" : "settings.browser.dataCleared");
  };

  const unavailable = !onClearData ? t("settings.browser.unavailable") : undefined;
  return (
    <div className="mx-auto w-full max-w-[832px] space-y-5" data-testid="browser-settings">
      <h1 className="mb-7 text-[28px] font-bold text-(--color-foreground-strong)">{t("settings.section.browser")}</h1>
      <div className={card}>
        <SettingsRow title={t("settings.browser.enabled")} desc={t("settings.browser.enabled.desc")}>
          <Switch
            tone="neutral"
            checked={settings?.browserEnabled !== false}
            disabled={!settings || busy !== null}
            label={t("settings.browser.enabled")}
            onChange={(next) => void perform("enabled", () => onPatchSettings({ browserEnabled: next }))}
          />
        </SettingsRow>
      </div>

      <section aria-labelledby="browser-security-title">
        <h2 id="browser-security-title" className="mb-3 text-(--color-muted)">{t("settings.browser.security")}</h2>
        <div className={card}>
          <SettingsRow title={t("settings.browser.ignoreCertificates")} desc={t("settings.browser.ignoreCertificates.desc")}>
            <Switch
              tone="neutral"
              checked={settings?.browserIgnoreCertificateErrors === true}
              disabled={!settings || busy !== null}
              label={t("settings.browser.ignoreCertificates")}
              onChange={(next) => void perform("certificates", () => onPatchSettings({ browserIgnoreCertificateErrors: next }), "settings.browser.restartRequired")}
            />
          </SettingsRow>
        </div>
      </section>

      <section aria-labelledby="browser-data-title">
        <h2 id="browser-data-title" className="mb-3 text-(--color-muted)">{t("settings.browser.data")}</h2>
        <div className={card}>
          <SettingsRow title={t("settings.browser.clearCache")} desc={t("settings.browser.clearCache.desc")}>
            <button type="button" className={secondary} disabled={!onClearData || busy !== null}
              aria-description={unavailable} onClick={() => clear("cache")}>
              {t(busy === "cache" ? "settings.browser.clearing" : "settings.browser.clearCache.action")}
            </button>
          </SettingsRow>
          <SettingsRow title={t("settings.browser.clearAll")} desc={t("settings.browser.clearAll.desc")}>
            <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
              <Dialog.Trigger asChild>
                <button type="button" className={destructive} disabled={!onClearData || busy !== null} aria-description={unavailable}>
                  {t(busy === "all" ? "settings.browser.clearing" : "settings.browser.clearAll.action")}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-(--color-markdown-table-backdrop)" />
                <Dialog.Content className="modal-in fixed top-1/2 left-1/2 z-50 w-[calc(100%-3rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)">
                  <Dialog.Title className="font-semibold text-(--color-foreground-strong)">{t("settings.browser.confirm.title")}</Dialog.Title>
                  <Dialog.Description className="mt-2 text-(--color-muted)">{t("settings.browser.confirm.desc")}</Dialog.Description>
                  <div className="mt-5 flex justify-end gap-2">
                    <Dialog.Close asChild><button type="button" className={secondary}>{t("settings.dialog.cancel")}</button></Dialog.Close>
                    <button type="button" className={destructive} onClick={() => clear("all")}>{t("settings.browser.clearAll.action")}</button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </SettingsRow>
        </div>
      </section>
      {notice && <p role={notice.error ? "alert" : "status"} className={`break-words ${notice.error ? "text-(--color-tool-err)" : "text-(--color-muted)"}`}>{notice.text}</p>}
    </div>
  );
}
