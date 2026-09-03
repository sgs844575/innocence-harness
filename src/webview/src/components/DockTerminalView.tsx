// dock 终端页：一个标签一个独立 PTY（xterm 渲染）。标签切换只是隐藏（组件常驻
// 挂载，shell 存活）；关闭标签/卸载才真正 dispose。主题/字体读取 CSS token，
// 随 <html> 的 dark 类切换热更新。
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { hasTerminalBridge, terminalApi } from "../lib/terminal";

interface Props {
  t: (key: string) => string;
  /** dock 标签实例 id（一标签一终端）。 */
  terminalId: string;
  /** 工作目录（项目根；空串由主进程回退用户主目录）。 */
  workspaceRoot: string;
  /** 非激活标签 = 隐藏；重新可见时重新 fit 并同步 PTY 尺寸。 */
  visible: boolean;
  /** 代码字号（外观设置）。 */
  fontSize?: number;
}

/** 从 CSS token 读取终端主题（调用时机：挂载 + 明暗切换）。 */
function readTerminalTheme(): Record<string, string | undefined> {
  const styles = getComputedStyle(document.documentElement);
  const pick = (name: string): string | undefined => styles.getPropertyValue(name).trim() || undefined;
  return {
    background: pick("--color-background"),
    foreground: pick("--color-foreground"),
    cursor: pick("--color-foreground"),
    cursorAccent: pick("--color-background"),
    selectionBackground: pick("--color-selected"),
  };
}

export function DockTerminalView({ t, terminalId, workspaceRoot, visible, fontSize }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  /** PTY 创建完成前的按键缓冲（创建是异步的，立即打字不丢）。 */
  const pendingKeysRef = useRef("");

  useEffect(() => {
    const host = hostRef.current;
    if (!hasTerminalBridge() || !host) return;
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || undefined,
      fontSize: fontSize ?? 14,
      cursorBlink: true,
      theme: readTerminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    const offOutput = terminalApi.onDockTerminalOutput((event) => {
      if (event.terminalId === terminalId) term.write(event.data);
    });
    const offExit = terminalApi.onDockTerminalExit((event) => {
      if (event.terminalId === terminalId) {
        term.write(`\r\n\x1b[90m[${t("dock.terminal.exited")}${event.exitCode ?? ""}]\x1b[0m`);
      }
    });
    const dataSubscription = term.onData((data) => {
      const ptyId = ptyIdRef.current;
      if (ptyId) void terminalApi.dockWrite({ terminalId, ptyId, data }).catch(() => undefined);
      else pendingKeysRef.current += data;
    });
    // 明暗主题切换：重读 token 热更新终端配色。
    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTerminalTheme();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const dims = fit.proposeDimensions();
    void terminalApi
      .dockCreate({ terminalId, cwd: workspaceRoot, cols: dims?.cols, rows: dims?.rows })
      .then((created) => {
        ptyIdRef.current = created.ptyId;
        if (pendingKeysRef.current) {
          void terminalApi.dockWrite({ terminalId, ptyId: created.ptyId, data: pendingKeysRef.current }).catch(() => undefined);
          pendingKeysRef.current = "";
        }
      })
      .catch(() => term.write(`\x1b[31m[${t("dock.terminal.createFailed")}]\x1b[0m`));

    return () => {
      offOutput();
      offExit();
      dataSubscription.dispose();
      themeObserver.disconnect();
      const ptyId = ptyIdRef.current;
      ptyIdRef.current = null;
      // 卸载 = 标签关闭：按 terminalId 释放整个 PTY（ptyId 缺省路径）。
      void terminalApi.dockDispose({ terminalId, ...(ptyId ? { ptyId } : {}) }).catch(() => undefined);
      term.dispose();
    };
  }, [terminalId, workspaceRoot, fontSize, t]);

  // 重新可见 / 尺寸变化（dock 拖宽）：重新 fit 并把网格尺寸同步给 PTY。
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasTerminalBridge()) return;
    const sync = (): void => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit || host.offsetWidth === 0) return;
      fit.fit();
      const ptyId = ptyIdRef.current;
      if (ptyId) {
        void terminalApi.dockResize({ terminalId, ptyId, cols: term.cols, rows: term.rows }).catch(() => undefined);
      }
    };
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    if (visible) {
      const frame = requestAnimationFrame(sync);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }
    return () => observer.disconnect();
  }, [visible, terminalId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-(--color-background)">
      <div ref={hostRef} className="min-h-0 w-full flex-1 px-2 py-1" data-testid="dock-terminal-host" />
    </div>
  );
}
