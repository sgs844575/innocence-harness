// 品牌图标：<img> 渲染品牌集 SVG（单色版为 currentColor，需要随文字着色时
// 用 CSS filter 或直接用彩色版）。未命中时渲染 null，由调用方决定回落。
import { resolveBrandIcon } from "./brandIcons";

interface Props {
  /** 提供商 profile id/名称或模型 id。 */
  subject: string;
  color?: boolean;
  size?: number;
  className?: string;
  title?: string;
}

export function BrandIcon({ subject, color = false, size = 14, className, title }: Props): React.JSX.Element | null {
  const url = resolveBrandIcon(subject, color);
  if (url === null) return null;
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
