import { Puzzle } from "lucide-react";
import { ToolLine } from "./ToolLine";
import type { ToolCardProps } from "./registry";

/** 兜底行：未注册的工具统一走这里——工具名 + args JSON + 结果。 */
export function UnknownTool({ call, result, open, onToggle }: ToolCardProps): React.JSX.Element {
  return (
    <ToolLine
      icon={Puzzle}
      verb="工具"
      name={call.toolName}
      open={open}
      onToggle={onToggle}
      running={!result}
      error={result?.isError}
    >
      <div className="font-mono leading-relaxed text-(--color-app-muted)">
        <pre className="overflow-x-auto">{JSON.stringify(call.args, null, 2)}</pre>
        {result && <pre className="scrollbar-thin mt-1 max-h-48 overflow-auto">{result.content}</pre>}
      </div>
    </ToolLine>
  );
}
