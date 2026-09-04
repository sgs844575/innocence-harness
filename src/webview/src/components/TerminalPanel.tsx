// 聊天页底部终端面板（顶栏终端钮开合）：标签条（「终端」标识 + 终端 chip 列表
// + ＋ 新建 + X 收合）+ xterm 内容区。终端常驻挂载——收合面板/切换标签只是隐藏，
// 不杀 shell；点标签的 X 才释放对应 PTY（组件卸载 dispose）。
import { useEffect, useState } from "react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { DockTerminalView } from "./DockTerminalView";
import { projectName } from "../state/useSessions";

interface Props {
  t: (key: string) => string;
  /** 顶栏终端钮控制；收合 = 高度动画到 0（终端保持挂载，shell 存活）。 */
  open: boolean;
  /** 新终端的工作目录（当前项目根；空串由主进程回退用户主目录）。 */
  workspaceRoot: string;
  fontSize?: number;
  /** 生效终端字体（useTerminalFont 现算）；null/空串 = 沿用 --font-mono token。 */
  fontFamily?: string | null;
  onClose: () => void;
  /** 存活终端数变化上报（活动胶囊「终端」段的数据源）。 */
  onTerminalsChange?: (count: number) => void;
}

interface PanelTerminal {
  id: string;
  title: string;
  cwd: string;
}

let terminalSeq = 0;

/** 面板高度（内容定高，外层只裁剪——与 dock 宽度动画同模式）。 */
const PANEL_HEIGHT = 260;

export function TerminalPanel({ t, open, workspaceRoot, fontSize, fontFamily, onClose, onTerminalsChange }: Props): React.JSX.Element {
  const [terminals, setTerminals] = useState<PanelTerminal[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const addTerminal = (): void => {
    const terminal: PanelTerminal = {
      id: `panel_${Date.now().toString(36)}_${(terminalSeq++).toString(36)}`,
      title: workspaceRoot ? projectName(workspaceRoot) : t("dock.tile.terminal"),
      cwd: workspaceRoot,
    };
    setTerminals((list) => [...list, terminal]);
    setActiveId(terminal.id);
  };

  // 首次打开自动建一个终端；之后保持用户调整过的标签集（全部关完再给空态）。
  useEffect(() => {
    if (open && terminals.length === 0) addTerminal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 存活终端数上报（收合面板不杀 shell，数量不受 open 影响）。
  useEffect(() => {
    onTerminalsChange?.(terminals.length);
  }, [terminals.length, onTerminalsChange]);

  const closeTerminal = (id: string): void => {
    setTerminals((list) => {
      const next = list.filter((terminal) => terminal.id !== id);
      setActiveId((current) => (current === id ? (next.at(-1)?.id ?? null) : current));
      return next;
    });
  };

  const hasTerminals = terminals.length > 0;
  return (
    <div
      data-testid="terminal-panel"
      style={{ height: open ? PANEL_HEIGHT : 0 }}
      className={`shrink-0 overflow-hidden border-(--color-hairline) ${
        open ? "border-t" : ""
      } transition-[height] duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none`}
    >
      <div className="flex flex-col" style={{ height: PANEL_HEIGHT }}>
        {/* 标签条：「终端」标识 + 终端 chip（X 关闭单个）+ ＋ 新建 + X 收合面板。 */}
        <div className="flex h-9 shrink-0 items-center gap-1 px-2">
          <span className="flex items-center gap-1.5 px-1.5 text-[13px] text-(--color-muted) select-none">
            <SquareTerminal size={14} strokeWidth={1.5} aria-hidden />
            {t("dock.tile.terminal")}
          </span>
          {terminals.map((terminal) => (
            <span
              key={terminal.id}
              className={`flex h-6 items-center gap-1 rounded-md pr-0.5 pl-2 text-[13px] ${
                terminal.id === activeId ? "bg-(--color-selected) text-(--color-foreground)" : "text-(--color-muted) hover:bg-(--color-hover)"
              }`}
            >
              <button type="button" onClick={() => setActiveId(terminal.id)} className="max-w-36 truncate">
                {terminal.title}
              </button>
              <button
                type="button"
                onClick={() => closeTerminal(terminal.id)}
                aria-label={t("dock.closeTab")}
                title={t("dock.closeTab")}
                className="grid size-4.5 place-items-center rounded text-(--color-faint) hover:bg-(--color-hover) hover:text-(--color-foreground)"
              >
                <X size={11} strokeWidth={1.5} />
              </button>
            </span>
          ))}
          {!hasTerminals && (
            <span className="px-2 text-[12px] text-(--color-faint)">{t("terminal.empty")}</span>
          )}
          <button
            type="button"
            onClick={addTerminal}
            aria-label={t("terminal.new")}
            title={t("terminal.new")}
            className="grid size-6 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("terminal.close")}
            title={t("terminal.close")}
            className="grid size-6 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        {/* 终端内容区：常驻挂载，非激活/收合仅隐藏。 */}
        <div className="min-h-0 flex-1">
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={terminal.id === activeId ? "flex h-full min-h-0 flex-col" : "hidden"}
            >
              <DockTerminalView
                t={t}
                terminalId={terminal.id}
                workspaceRoot={terminal.cwd}
                visible={open && terminal.id === activeId}
                fontSize={fontSize}
                fontFamily={fontFamily}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
