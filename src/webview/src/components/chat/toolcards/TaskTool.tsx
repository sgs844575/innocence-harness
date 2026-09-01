import { Bot } from "lucide-react";
import { ToolLine } from "./ToolLine";
import type { ToolCardProps } from "./registry";

/** Task 行：子代理动词 + 任务摘要 + agentType 徽标，open 时展开子代理报告。 */
export function TaskTool({ call, result, open, onToggle }: ToolCardProps): React.JSX.Element {
  const desc = typeof call.args.description === "string" ? call.args.description : "";
  const agentType = typeof call.args.agentType === "string" ? call.args.agentType : "explore";
  return (
    <ToolLine
      icon={Bot}
      verb="子代理"
      name={desc || "任务"}
      extra={<span className="ml-1.5 rounded-full border border-(--color-app-hairline) px-1.5 font-mono text-(--color-app-muted)">{agentType}</span>}
      open={open}
      onToggle={onToggle}
      running={!result}
      error={result?.isError}
    >
      {result && (
        <pre className="scrollbar-thin max-h-48 overflow-auto font-mono leading-relaxed text-(--color-app-muted)">{result.content}</pre>
      )}
    </ToolLine>
  );
}
