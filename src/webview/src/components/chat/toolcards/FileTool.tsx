import { FileSearch, FileText } from "lucide-react";
import { ToolLine } from "./ToolLine";
import { FileIcon } from "../../icons/FileIcon";
import type { ToolCardProps } from "./registry";

const PATH_KEYS = ["file_path", "path", "pattern"] as const;

const VERBS: Record<string, string> = {
  Read: "读取",
  Write: "写入",
  Glob: "搜索",
  Grep: "搜索",
};

/** 文件行卡：Read/Write/Glob/Grep 共用——动词 + 彩色文件图标 + 目标，open 时输出。 */
export function FileTool({ call, result, open, onToggle }: ToolCardProps): React.JSX.Element {
  const key = PATH_KEYS.find((k) => typeof call.args[k] === "string") ?? PATH_KEYS[0];
  const target = String(call.args[key] ?? "");
  const Icon = call.toolName === "Read" || call.toolName === "Write" ? FileText : FileSearch;
  return (
    <ToolLine
      icon={Icon}
      verb={VERBS[call.toolName] ?? call.toolName}
      fileIcon={<FileIcon path={target} />}
      name={target}
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
