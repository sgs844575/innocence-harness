import { useState } from "react";
import type { ToolCallPart, ToolResultPart } from "../../../../shared/ipc";
import { ToolCardRow } from "./toolcards/registry";
import { pairTools } from "./turnSummary";

interface Props {
  parts: (ToolCallPart | ToolResultPart)[];
  live: boolean;
  t: (key: string) => string;
}

/** 工具时间线：每个工具调用一行紧凑行（参考稿 tool-row 节奏），
 * 不再折叠成组——回顾时每个动作都直接可见，点击行下钻明细。 */
export function TurnCollapse({ parts }: Props): React.JSX.Element | null {
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  const pairs = pairTools(parts);
  if (pairs.length === 0) return null;
  return (
    <div className="flex flex-col gap-[10px]">
      {pairs.map(({ call, result }) => {
        const open = openTools.has(call.id) ?? false;
        return (
          <ToolCardRow
            key={call.id}
            call={call}
            result={result}
            open={open}
            onToggle={() =>
              setOpenTools((prev) => {
                const next = new Set(prev);
                if (next.has(call.id)) next.delete(call.id);
                else next.add(call.id);
                return next;
              })
            }
          />
        );
      })}
    </div>
  );
}
