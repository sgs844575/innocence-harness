import type { ComponentType } from "react";
import { Plug } from "lucide-react";
import { ToolLine } from "./ToolLine";
import type { ToolCardProps } from "./registry";

/**
 * 描述符式工具卡契约（插件 client 注册面 v1 的载荷形状）：纯数据，由宿主
 * 统一渲染——client 模块零 import 铁律（不引用 React/宿主类型），组件级
 * 注册延后阶段 2。
 */
export interface ToolCardDescriptor {
  /** 标题徽标文本；缺省回落工具名。 */
  title?: string;
  /** 展开态是否渲染参数 JSON（默认 true）。 */
  renderArgs?: boolean;
  /** 展开态是否渲染结果内容（默认 true）。 */
  renderResult?: boolean;
}

/** 描述符驱动的通用行：title 主名 + 参数 JSON 折叠 + 结果/耗时/错误态
 *  （结构随 McpToolCard/UnknownTool 同款紧凑行）。 */
export function DescriptorToolCard({
  descriptor,
  call,
  result,
  open,
  onToggle,
}: ToolCardProps & { descriptor: ToolCardDescriptor }): React.JSX.Element {
  const title = descriptor.title ?? call.toolName;
  return (
    <ToolLine
      icon={Plug}
      verb="插件工具"
      name={title}
      open={open}
      onToggle={onToggle}
      running={!result}
      error={result?.isError}
      doneNote={
        result?.durationMs ? (
          <span className="text-(--color-app-muted)/70">{(result.durationMs / 1000).toFixed(1)}s</span>
        ) : null
      }
    >
      <div className="font-mono leading-relaxed text-(--color-app-muted)">
        {descriptor.renderArgs !== false && (
          <pre className="scrollbar-thin max-h-48 overflow-auto">{JSON.stringify(call.args, null, 2)}</pre>
        )}
        {descriptor.renderResult !== false && result && (
          <pre className="scrollbar-thin mt-1 max-h-48 overflow-auto">{result.content}</pre>
        )}
      </div>
    </ToolLine>
  );
}

/** 注册值工厂：闭包持有描述符，产出键控槽位值契约（ComponentType）的包装组件。 */
export function createDescriptorCard(descriptor: ToolCardDescriptor): ComponentType<ToolCardProps> {
  return function DescriptorCard(props: ToolCardProps): React.JSX.Element {
    return <DescriptorToolCard {...props} descriptor={descriptor} />;
  };
}
