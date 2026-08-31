// ToolLine — 紧凑工具行外壳（参考稿 tool-row 语言）：
//   [图标] 动词 [文件图标] 名称 路径 …扩展槽（diff/徽标）      状态
// 运行中：图标位换旋转环 + 行内扫光；完成态不显示状态（错误 ✕ 除外）。
// 点击整行展开明细——明细为缩进的沉底面块（不再是卡片盒）。
import type { ComponentType, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export interface ToolLineProps {
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  /** 动词（写入/编辑/读取/搜索/终端…），缺省隐藏。 */
  verb?: string;
  /** 彩色文件类型图标节点（FileIcon）。 */
  fileIcon?: ReactNode;
  /** 主名（文件名/命令/摘要），font-semibold。 */
  name?: ReactNode;
  /** 路径段（目录/服务器名），muted。 */
  path?: ReactNode;
  /** 行内扩展槽（diff 计数、徽标等），紧跟路径之后。 */
  extra?: ReactNode;
  open: boolean;
  onToggle: () => void;
  running: boolean;
  error?: boolean;
  /** 完成态右侧的轻信息（耗时等）；错误 ✕ 优先生效。 */
  doneNote?: ReactNode;
  children?: ReactNode;
}

export function ToolLine({
  icon: Icon,
  verb,
  fileIcon,
  name,
  path,
  extra,
  open,
  onToggle,
  running,
  error,
  doneNote,
  children,
}: ToolLineProps): React.JSX.Element {
  return (
    <div className={running ? "tool-sweep rounded-md" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-6 w-full items-center gap-2.5 rounded-md px-0.5 text-left text-[13px] whitespace-nowrap hover:bg-(--color-app-hover)/60"
      >
        {running ? (
          <LoaderCircle size={15} className="shrink-0 animate-spin text-(--color-app-muted)" />
        ) : (
          <Icon size={15} strokeWidth={1.1} className="shrink-0 text-(--color-app-muted)" />
        )}
        {verb && <span className="shrink-0 text-(--color-app-muted)">{verb}</span>}
        {fileIcon}
        {name !== undefined && name !== "" && (
          <span className="min-w-0 shrink-0 truncate font-semibold text-(--color-app-text)">{name}</span>
        )}
        {path !== undefined && path !== "" && (
          <span className="min-w-0 shrink-0 truncate text-[13px] text-(--color-app-muted)">{path}</span>
        )}
        {extra}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 text-[12.5px]">
          {error ? <span className="text-(--color-tool-err)">✕</span> : !running && doneNote}
        </span>
      </button>
      {open && children !== undefined && (
        <div className="mt-1 mb-3 ml-[25px] rounded-[8px] bg-(--color-code-bg) p-2.5">{children}</div>
      )}
    </div>
  );
}
