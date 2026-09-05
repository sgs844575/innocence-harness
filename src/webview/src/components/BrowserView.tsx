// dock 浏览器标签：内嵌 <webview> 访客页（独立进程，persist:browser 分区）。
// 导航条：后退/前进/刷新 + URL 输入（回车加载）+ 设备模拟（适应窗口/手机）
// + 检查元素（注入悬停高亮浮签）+ …菜单（默认浏览器打开 / 打开调试工具）。
// 页面标题/favicon 经 onTitleChange 回写 dock 标签 chip。
import { useEffect, useRef, useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Check,
  Crosshair,
  ExternalLink,
  Globe,
  LoaderCircle,
  MonitorSmartphone,
  MoreHorizontal,
  RotateCw,
} from "lucide-react";
import { api, hasBridge } from "../lib/ipc";
import { normalizeUrl } from "./browserUrl";
import { INSPECT_OVERLAY_SCRIPT } from "./browserInspect";
import { BROWSER_PARTITION } from "../../../shared/browserIpc";

/** <webview> 元素（Electron 专有，JSX 无内建类型）：窄接口 + 运行时才存在的方法。 */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  openDevTools(): void;
  executeJavaScript(code: string): Promise<unknown>;
  getWebContentsId(): number;
  getURL(): string;
  getTitle(): string;
}
const WebviewTag = "webview" as unknown as React.ElementType;

/** 设备预设：null = 适应窗口（清除仿真覆盖）。 */
interface DevicePreset {
  key: "fit" | "mobile";
  width: number | null;
  height: number | null;
  mobile: boolean;
}
const FIT_PRESET: DevicePreset = { key: "fit", width: null, height: null, mobile: false };
const MOBILE_PRESET: DevicePreset = { key: "mobile", width: 393, height: 852, mobile: true };

interface Props {
  t: (key: string) => string;
  /** 页面标题/favicon 回写（dock 标签 chip）。 */
  onTitleChange: (title: string, favicon?: string) => void;
}

export function BrowserView({ t, onTitleChange }: Props): React.JSX.Element {
  const viewRef = useRef<WebviewElement | null>(null);
  const guestIdRef = useRef<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [device, setDevice] = useState<DevicePreset>(FIT_PRESET);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inspectOn, setInspectOn] = useState(false);
  // 已挂 src 标记：webview 的 src 仅首载设置，后续导航走 loadURL（src 变更不可靠）。
  const [mountedUrl, setMountedUrl] = useState<string | null>(null);

  const load = (raw: string): void => {
    const url = normalizeUrl(raw);
    if (!url) return;
    setLoadError(null);
    // 首载经 src 挂载访客（viewRef 尚为空）；后续导航走 loadURL。
    if (mountedUrl === null) {
      setMountedUrl(url);
      return;
    }
    const view = viewRef.current;
    if (view && typeof view.loadURL === "function") void view.loadURL(url).catch(() => undefined);
  };

  const applyDevice = (preset: DevicePreset): void => {
    setDevice(preset);
    setDeviceOpen(false);
    const guestId = guestIdRef.current;
    if (guestId === null || !hasBridge()) return;
    void api
      .browserEmulate({ guestId, width: preset.width, height: preset.height, mobile: preset.mobile })
      .catch(() => undefined);
  };

  const toggleInspect = (): void => {
    const view = viewRef.current;
    if (!view || mountedUrl === null || typeof view.executeJavaScript !== "function") return;
    void view
      .executeJavaScript(INSPECT_OVERLAY_SCRIPT)
      .then((result) => setInspectOn(result === "on"))
      .catch(() => setInspectOn(false));
  };

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const syncNav = (): void => {
      const url = view.getURL();
      setCurrentUrl(url || null);
      setInputValue(url);
      setCanBack(view.canGoBack());
      setCanFwd(view.canGoForward());
      // 成功导航清失败态；页面上下文已换，检查浮签随之销毁。
      setLoadError(null);
      setInspectOn(false);
      onTitleChange(view.getTitle() || url, undefined);
    };
    const onDomReady = (): void => {
      guestIdRef.current = view.getWebContentsId();
    };
    const onTitle = (event: Event): void => {
      onTitleChange((event as { title?: string }).title ?? "", undefined);
    };
    const onFavicon = (event: Event): void => {
      const favicons = (event as { favicons?: string[] }).favicons;
      if (favicons?.[0]) onTitleChange(view.getTitle() || view.getURL(), favicons[0]);
    };
    const onStart = (): void => setLoading(true);
    const onStop = (): void => {
      setLoading(false);
      setCanBack(view.canGoBack());
      setCanFwd(view.canGoForward());
    };
    const onFail = (event: Event): void => {
      const failure = event as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      // -3 ERR_ABORTED = 重定向/用户中止的常见噪音，不当失败展示。
      if (failure.isMainFrame === false || failure.errorCode === -3) return;
      setLoading(false);
      setLoadError(failure.errorDescription || t("dock.browser.loadFailed"));
    };
    const onNewWindow = (event: Event): void => {
      // 访客内 target=_blank / window.open：同页导航，不放行系统窗口。
      const url = (event as { url?: string }).url;
      const normalized = url ? normalizeUrl(url) : null;
      if (normalized) void view.loadURL(normalized).catch(() => undefined);
    };
    view.addEventListener("dom-ready", onDomReady);
    view.addEventListener("did-navigate", syncNav);
    view.addEventListener("did-navigate-in-page", syncNav);
    view.addEventListener("page-title-updated", onTitle);
    view.addEventListener("page-favicon-updated", onFavicon);
    view.addEventListener("did-start-loading", onStart);
    view.addEventListener("did-stop-loading", onStop);
    view.addEventListener("did-fail-load", onFail);
    view.addEventListener("new-window", onNewWindow);
    return () => {
      view.removeEventListener("dom-ready", onDomReady);
      view.removeEventListener("did-navigate", syncNav);
      view.removeEventListener("did-navigate-in-page", syncNav);
      view.removeEventListener("page-title-updated", onTitle);
      view.removeEventListener("page-favicon-updated", onFavicon);
      view.removeEventListener("did-start-loading", onStart);
      view.removeEventListener("did-stop-loading", onStop);
      view.removeEventListener("did-fail-load", onFail);
      view.removeEventListener("new-window", onNewWindow);
    };
  }, [onTitleChange, t]);

  const iconButton =
    "grid size-7 shrink-0 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground) disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div data-testid="browser-view" className="flex min-h-0 flex-1 flex-col">
      {/* 导航条：后退/前进/刷新 + URL 输入 + 设备 + 检查元素 + … 菜单。 */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-(--color-hairline) px-2">
        <button type="button" aria-label={t("dock.browser.back")} title={t("dock.browser.back")} disabled={!canBack}
          onClick={() => viewRef.current?.goBack()} className={iconButton}>
          <ArrowLeft size={15} strokeWidth={1.5} />
        </button>
        <button type="button" aria-label={t("dock.browser.forward")} title={t("dock.browser.forward")} disabled={!canFwd}
          onClick={() => viewRef.current?.goForward()} className={iconButton}>
          <ArrowRight size={15} strokeWidth={1.5} />
        </button>
        <button type="button" aria-label={t("dock.browser.reload")} title={t("dock.browser.reload")} disabled={mountedUrl === null}
          onClick={() => viewRef.current?.reload()} className={iconButton}>
          {loading ? (
            <LoaderCircle size={15} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <RotateCw size={15} strokeWidth={1.5} />
          )}
        </button>
        <input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") load(inputValue);
          }}
          onFocus={(event) => event.target.select()}
          placeholder={t("dock.browser.placeholder")}
          aria-label={t("dock.browser.placeholder")}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-lg bg-(--color-raised) px-2.5 font-mono text-[12px] text-(--color-foreground) outline-none placeholder:font-sans placeholder:text-(--color-faint) focus:bg-(--color-hover)"
        />
        {/* 设备模拟（参考 m3：尺寸文本 + 适应窗口下拉）。 */}
        <RadixPopover.Root open={deviceOpen} onOpenChange={setDeviceOpen}>
          <RadixPopover.Trigger asChild>
            <button
              type="button"
              aria-label={t("dock.browser.device")}
              title={t("dock.browser.device")}
              aria-expanded={deviceOpen}
              aria-pressed={device.key !== "fit"}
              className={`${iconButton} ${device.key !== "fit" ? "bg-(--color-selected) text-(--color-foreground)" : ""}`}
            >
              <MonitorSmartphone size={15} strokeWidth={1.5} />
            </button>
          </RadixPopover.Trigger>
          <RadixPopover.Portal>
            <RadixPopover.Content align="end" side="bottom" sideOffset={6}
              className="dropdown-in z-50 w-[180px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1.5 shadow-(--shadow-pop)">
              {[FIT_PRESET, MOBILE_PRESET].map((preset) => (
                <button key={preset.key} type="button" onClick={() => applyDevice(preset)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-(--color-foreground) hover:bg-(--color-hover)">
                  <span className="flex-1">
                    {preset.key === "fit" ? t("dock.browser.fit") : `${t("dock.browser.mobile")} ${preset.width} × ${preset.height}`}
                  </span>
                  {preset.key === device.key && <Check size={13} strokeWidth={1.5} className="text-(--color-accent)" aria-hidden />}
                </button>
              ))}
            </RadixPopover.Content>
          </RadixPopover.Portal>
        </RadixPopover.Root>
        <button
          type="button"
          aria-label={t("dock.browser.inspect")}
          title={t("dock.browser.inspect")}
          aria-pressed={inspectOn}
          disabled={mountedUrl === null}
          onClick={toggleInspect}
          className={`${iconButton} ${inspectOn ? "bg-(--color-selected) text-(--color-foreground)" : ""}`}
        >
          <Crosshair size={15} strokeWidth={1.5} />
        </button>
        {/* … 菜单：默认浏览器打开 / 打开调试工具。 */}
        <RadixPopover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <RadixPopover.Trigger asChild>
            <button type="button" aria-label={t("dock.browser.more")} title={t("dock.browser.more")} aria-expanded={menuOpen} className={iconButton}>
              <MoreHorizontal size={15} strokeWidth={1.5} />
            </button>
          </RadixPopover.Trigger>
          <RadixPopover.Portal>
            <RadixPopover.Content align="end" side="bottom" sideOffset={6}
              className="dropdown-in z-50 w-[200px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1.5 shadow-(--shadow-pop)">
              <button
                type="button"
                disabled={currentUrl === null}
                onClick={() => {
                  setMenuOpen(false);
                  if (currentUrl && hasBridge()) void api.openExternal(currentUrl).catch(() => undefined);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-(--color-foreground) hover:bg-(--color-hover) disabled:opacity-40"
              >
                <ExternalLink size={14} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" aria-hidden />
                {t("dock.browser.openExternal")}
              </button>
              <button
                type="button"
                disabled={mountedUrl === null}
                onClick={() => {
                  setMenuOpen(false);
                  viewRef.current?.openDevTools();
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-(--color-foreground) hover:bg-(--color-hover) disabled:opacity-40"
              >
                <Bug size={14} strokeWidth={1.5} className="shrink-0 text-(--color-muted)" aria-hidden />
                {t("dock.browser.devtools")}
              </button>
            </RadixPopover.Content>
          </RadixPopover.Portal>
        </RadixPopover.Root>
      </div>
      {/* 页面区：空态 / 失败态 / 访客页（设备预设下按预设宽度居中，超出横滚）。 */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex h-full min-h-0 flex-col" style={{ width: device.width ?? "100%" }}>
          {mountedUrl !== null && (
            <WebviewTag
              ref={viewRef}
              src={mountedUrl}
              partition={BROWSER_PARTITION}
              webpreferences="contextIsolation=yes, sandbox=yes, nodeIntegration=no"
              allowpopups="false"
              className={`min-h-0 w-full flex-1${loadError !== null ? " hidden" : ""}`}
            />
          )}
          {mountedUrl === null && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Globe size={22} strokeWidth={1.3} className="text-(--color-faint)" aria-hidden />
              <span className="text-[13px] font-medium text-(--color-foreground)">{t("dock.tile.browser")}</span>
              <span className="text-[12px] text-(--color-faint)">{t("dock.browser.emptyHint")}</span>
            </div>
          )}
          {loadError !== null && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Globe size={22} strokeWidth={1.3} className="text-(--color-tool-err)" aria-hidden />
              <span className="text-[13px] font-medium text-(--color-foreground)">{t("dock.browser.loadFailed")}</span>
              <span className="text-[12px] text-(--color-faint)">{loadError}</span>
              <button
                type="button"
                onClick={() => load(inputValue)}
                className="mt-1 rounded-lg bg-(--color-raised) px-3 py-1.5 text-[13px] text-(--color-foreground) hover:bg-(--color-hover)"
              >
                {t("dock.browser.retry")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
