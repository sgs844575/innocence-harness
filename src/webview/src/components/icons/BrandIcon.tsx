// 品牌图标：<img> 渲染品牌集 SVG。单色资产为 currentColor——<img> 内无
// CSS 电流色上下文（解析为黑），暗色主题下通过 .brand-mono 反色为白。
// 未命中时渲染 null，由调用方决定回落。
import { resolveBrand } from "./brandIcons";

interface Props {
  /** 提供商 profile id/名称或模型 id。 */
  subject: string;
  color?: boolean;
  size?: number;
  className?: string;
  title?: string;
}

export function BrandIcon({ subject, color = false, size = 14, className, title }: Props): React.JSX.Element | null {
  const resolved = resolveBrand(subject, color);
  if (resolved === null) return null;
  return (
    <img
      src={resolved.url}
      alt=""
      width={size}
      height={size}
      draggable={false}
      title={title}
      className={`${resolved.mono ? "brand-mono" : ""} shrink-0 block ${className ?? ""}`}
    />
  );
}
