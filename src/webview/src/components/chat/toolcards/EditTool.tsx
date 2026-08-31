import { FilePenLine } from "lucide-react";
import { ToolLine } from "./ToolLine";
import { FileIcon } from "../../icons/FileIcon";
import type { ToolCardProps } from "./registry";

function splitPath(file: string): { name: string; dir: string } {
  const cut = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return cut < 0 ? { name: file, dir: "" } : { name: file.slice(cut + 1), dir: file.slice(0, cut + 1) };
}

/** Edit 行：写入/编辑动词 + 彩色文件图标 + 文件名/目录 + +/- 计数，open 时逐行 diff。 */
export function EditTool({ call, result, open, onToggle }: ToolCardProps): React.JSX.Element {
  const file =
    typeof call.args.file_path === "string"
      ? call.args.file_path
      : typeof call.args.path === "string"
        ? call.args.path
        : "";
  const oldS = typeof call.args.old_string === "string" ? call.args.old_string : "";
  const newS = typeof call.args.new_string === "string" ? call.args.new_string : "";
  const add = newS.split("\n").length;
  const del = oldS.split("\n").length;
  const verb = oldS === "" ? "写入" : "编辑";
  const { name, dir } = splitPath(file);
  return (
    <ToolLine
      icon={FilePenLine}
      verb={verb}
      fileIcon={<FileIcon path={file} />}
      name={name}
      path={dir}
      extra={
        <>
          <span className="ml-1.5 text-[12.5px] text-(--color-diff-add)">+{add}</span>
          <span className="ml-2 text-[12.5px] text-(--color-diff-del)">−{del}</span>
        </>
      }
      open={open}
      onToggle={onToggle}
      running={!result}
      error={result?.isError}
    >
      <pre className="scrollbar-thin max-h-56 overflow-auto font-mono text-[11.5px] leading-relaxed">
        {oldS.split("\n").map((l, i) => (
          <span key={`d${i}`} className="block bg-(--color-diff-del-bg) px-1.5 text-(--color-diff-del)">− {l}</span>
        ))}
        {newS.split("\n").map((l, i) => (
          <span key={`a${i}`} className="block bg-(--color-diff-add-bg) px-1.5 text-(--color-diff-add)">+ {l}</span>
        ))}
      </pre>
    </ToolLine>
  );
}
