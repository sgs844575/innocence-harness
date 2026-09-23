// 助手消息分段（纯函数）：parts → thinking / text / tools 段。
// 流式期间逐段渲染贴近执行过程；整轮完成后连续工具段归并成一条时间线。
// 工具活动是硬边界；工具段区间内思考与正文各自归并成一段——交错推理模型
// （思考增量夹在正文增量之间逐条推送）不会把正文撕成碎片 markdown（代码
// 围栏跨段后永远配不上对），也不会把思考行刷成一片。
import type { MessagePart, ToolCallPart, ToolResultPart } from "../../../../shared/ipc";

export type Segment =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tools"; parts: (ToolCallPart | ToolResultPart)[] };

export function segmentParts(parts: readonly MessagePart[]): Segment[] {
  const segments: Segment[] = [];
  /** 向前找最近的同类可归并段：跨过思考/正文段，工具段挡住（硬边界）。 */
  const findMergable = (kind: "thinking" | "text"): { text: string } | undefined => {
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index]!;
      if (segment.kind === "tools") return undefined;
      if (segment.kind === kind) return segment;
    }
    return undefined;
  };
  for (const part of parts) {
    if (part.type === "thinking") {
      const target = findMergable("thinking");
      if (target) target.text += part.text;
      else segments.push({ kind: "thinking", text: part.text });
    } else if (part.type === "text") {
      const target = findMergable("text");
      if (target) target.text += part.text;
      else segments.push({ kind: "text", text: part.text });
    } else if (part.type === "attachment") {
      // 附件 part 属于用户消息（气泡侧渲染）；助手分段防御性跳过。
      continue;
    } else {
      const last = segments[segments.length - 1];
      if (last?.kind === "tools") last.parts.push(part);
      else segments.push({ kind: "tools", parts: [part] });
    }
  }
  return segments;
}
