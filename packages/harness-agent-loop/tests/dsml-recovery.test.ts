import { describe, expect, it } from "vitest";
import type { MessagePart } from "@innocenceharness/harness-session";
import { recoverDsmlToolCalls } from "../src/dsml-recovery";

// 与实机漏出形态一致的样例信封：字符串参数（string="true"）与数值参数
// （string="false"）各一，双 invoke 并行。
const envelope = [
  "<｜DSML｜｜tool_calls>",
  '<｜DSML｜｜invoke name="Read">',
  '<｜DSML｜｜parameter name="path" string="true">package.json</｜DSML｜｜parameter>',
  '<｜DSML｜｜parameter name="offset" string="false">95</｜DSML｜｜parameter>',
  '<｜DSML｜｜parameter name="limit" string="false">10</｜DSML｜｜parameter>',
  "</｜DSML｜｜invoke>",
  '<｜DSML｜｜invoke name="Glob">',
  '<｜DSML｜｜parameter name="pattern" string="true">.*</｜DSML｜｜parameter>',
  "</｜DSML｜｜invoke>",
  "</｜DSML｜｜tool_calls>",
].join(" ");

const text = (value: string): MessagePart => ({ type: "text", text: value });

describe("recoverDsmlToolCalls", () => {
  it("整段信封回收为结构化调用：字符串原样、数值还原、文本剥离", () => {
    const parts = recoverDsmlToolCalls([text(envelope)], () => "c1");
    const calls = parts.filter((part) => part.type === "toolCall");
    expect(parts.some((part) => part.type === "text")).toBe(false);
    expect(calls).toEqual([
      { type: "toolCall", id: "c1", toolName: "Read", args: { path: "package.json", offset: 95, limit: 10 } },
      { type: "toolCall", id: "c1", toolName: "Glob", args: { pattern: ".*" } },
    ]);
  });

  it("信封前后的正常文本保留", () => {
    const parts = recoverDsmlToolCalls([text(`先读文件 ${envelope} 再说`)], () => "c1");
    const textPart = parts.find((part) => part.type === "text");
    expect(textPart).toMatchObject({ type: "text", text: expect.stringMatching(/^先读文件\s*再说$/) });
    expect(parts.filter((part) => part.type === "toolCall")).toHaveLength(2);
  });

  it("无标记时原样返回入参引用（零开销路径）", () => {
    const input = [text("普通正文"), { type: "thinking", text: "推理" } as MessagePart];
    expect(recoverDsmlToolCalls(input, () => "c1")).toBe(input);
  });

  it("不完整信封（流被截断）保持原样，不猜测回收", () => {
    const partial = "<｜DSML｜｜tool_calls> <｜DSML｜｜invoke name=\"Read\">截断";
    const parts = recoverDsmlToolCalls([text(partial)], () => "c1");
    expect(parts).toEqual([text(partial)]);
  });

  it("非字符串参数的 JSON 形态按对象还原", () => {
    const jsonEnvelope = [
      "<｜DSML｜｜tool_calls>",
      '<｜DSML｜｜invoke name="Write">',
      '<｜DSML｜｜parameter name="content" string="false">{"a":1}</｜DSML｜｜parameter>',
      "</｜DSML｜｜invoke>",
      "</｜DSML｜｜tool_calls>",
    ].join(" ");
    const parts = recoverDsmlToolCalls([text(jsonEnvelope)], () => "c1");
    expect(parts.find((part) => part.type === "toolCall")).toMatchObject({
      toolName: "Write",
      args: { content: { a: 1 } },
    });
  });
});
