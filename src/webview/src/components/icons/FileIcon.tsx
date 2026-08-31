// 文件类型图标：<img> 渲染随包图标集里的彩色 SVG；集合未覆盖时回落到
// 通用文件线形图标（保持原有组件语言）。主题变化通过 props 显式传入，
// 由调用方在主题切换重渲染时更新（root class 翻转必然伴随一次重渲染）。
import { File } from "lucide-react";
import { resolveFileIcon } from "./fileIcons";
import { currentTheme } from "../../lib/theme";

interface Props {
  /** 完整路径或裸文件名；映射按文件名与扩展名解析。 */
  path: string;
  /** 像素尺寸（默认 15，与紧凑工具行同栅格）。 */
  size?: number;
  className?: string;
  title?: string;
}

export function FileIcon({ path, size = 15, className, title }: Props): React.JSX.Element {
  const light = currentTheme()?.resolved === "light";
  const url = resolveFileIcon(path, light);
  if (url === null) {
    return <File size={size} strokeWidth={1.1} className={`shrink-0 text-(--color-app-muted) ${className ?? ""}`} aria-hidden />;
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      draggable={false}
      title={title}
      className={`shrink-0 block ${className ?? ""}`}
    />
  );
}
