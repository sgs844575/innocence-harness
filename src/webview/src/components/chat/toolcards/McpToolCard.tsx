import { Plug } from "lucide-react";
import { ToolLine } from "./ToolLine";
import type { ToolCardProps } from "./registry";

/** 外部工具名约定前缀：mcp__<server>__<tool>（段内单下划线合法，双下划线为分隔）。 */
const MCP_PREFIX = "mcp__";

/** 从工具名解析服务器段与工具段；缺段时退化为仅服务器段展示。 */
function parseMcpName(toolName: string): { server: string; tool: string } {
  const rest = toolName.startsWith(MCP_PREFIX) ? toolName.slice(MCP_PREFIX.length) : toolName;
  const separator = rest.indexOf("__");
  return separator < 0
    ? { server: rest, tool: "" }
    : { server: rest.slice(0, separator), tool: rest.slice(separator + 2) };
}

/** 外部服务器通用行：服务器段为路径位、工具段为主名 + 参数折叠 + 结果/耗时/错误态。 */
export function McpToolCard({ call, result, open, onToggle }: ToolCardProps): React.JSX.Element {
  const { server, tool } = parseMcpName(call.toolName);
  return (
    <ToolLine
      icon={Plug}
      verb="外部工具"
      path={server}
      name={tool || undefined}
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
        <pre className="scrollbar-thin max-h-48 overflow-auto">{JSON.stringify(call.args, null, 2)}</pre>
        {result && <pre className="scrollbar-thin mt-1 max-h-48 overflow-auto">{result.content}</pre>}
      </div>
    </ToolLine>
  );
}
