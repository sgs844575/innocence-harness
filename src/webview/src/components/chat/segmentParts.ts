// 助手消息分段（纯函数）：parts → thinking / text / tools 段。
// 流式期间逐段渲染贴近执行过程；整轮完成后连续工具段归并成一条时间线。
import type { MessagePart, ToolCallPart, ToolResultPart } from "../../../../shared/ipc";

export type Segment =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tools"; parts: (ToolCallPart | ToolResultPart)[] };

export function segmentParts(parts: readonly MessagePart[]): Segment[] {
  const segments: Segment[] = [];
  for (const part of parts) {
    const last = segments[segments.length - 1];
    if (part.type === "thinking") {
      if (last?.kind === "thinking") last.text += part.text;
      else segments.push({ kind: "thinking", text: part.text });
    } else if (part.type === "text") {
      if (last?.kind === "text") last.text += part.text;
      else segments.push({ kind: "text", text: part.text });
    } else if (part.type === "attachment") {
      // 附件 part 属于用户消息（气泡侧渲染）；助手分段防御性跳过。
      continue;
    } else {
      if (last?.kind === "tools") last.parts.push(part);
      else segments.push({ kind: "tools", parts: [part] });
    }
  }
  return segments;
}
