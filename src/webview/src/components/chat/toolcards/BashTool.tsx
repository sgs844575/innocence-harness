import { Terminal } from "lucide-react";
import { ToolLine } from "./ToolLine";
import type { ToolCardProps } from "./registry";

/** Bash 行：终端动词 + 命令单行（运行态动词提亮），open 时滚动输出。 */
export function BashTool({ call, result, open, onToggle }: ToolCardProps): React.JSX.Element {
  const command = typeof call.args.command === "string" ? call.args.command : JSON.stringify(call.args);
  const running = !result;
  return (
    <ToolLine
      icon={Terminal}
      verb={running ? "正在执行" : "终端"}
      name={<span className="min-w-0 truncate font-normal text-(--color-app-muted)">{command}</span>}
      open={open}
      onToggle={onToggle}
      running={running}
      error={result?.isError}
    >
      {result && (
        <pre className="scrollbar-thin max-h-56 overflow-auto font-mono leading-relaxed text-(--color-code-fg)/80">{result.content}</pre>
      )}
    </ToolLine>
  );
}
