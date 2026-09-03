import { describe, expect, it } from "vitest";
import type { MessagePart } from "../../../../shared/ipc";
import { buildToolRows, latestTodos, runToolsToTimelineRows } from "./toolRows";
import { segmentParts } from "./segmentParts";

describe("segmentParts", () => {
  it("同类相邻 part 合并，工具段连续归并", () => {
    const parts: MessagePart[] = [
      { type: "thinking", text: "a" },
      { type: "thinking", text: "b" },
      { type: "text", text: "t1" },
      { type: "toolCall", id: "c1", toolName: "Read", args: {} },
      { type: "toolResult", toolCallId: "c1", content: "ok", isError: false },
      { type: "toolCall", id: "c2", toolName: "Edit", args: {} },
      { type: "text", text: "t2" },
    ];
    const segments = segmentParts(parts);
    expect(segments.map((s) => s.kind)).toEqual(["thinking", "text", "tools", "text"]);
    expect(segments[0]).toMatchObject({ text: "ab" });
    expect(segments[2]).toMatchObject({ parts: expect.arrayContaining([expect.objectContaining({ id: "c2" })]) });
  });
});

describe("buildToolRows", () => {
  it("编辑行：文件名 + 目录 + ±行数；无结果 = 运行中", () => {
    const parts: MessagePart[] = [
      { type: "toolCall", id: "c1", toolName: "Edit", args: { file_path: "D:/x/src/app.css", old_string: "a\nb", new_string: "a\nc\nd" } },
      { type: "toolResult", toolCallId: "c1", content: "done", isError: false, durationMs: 12 },
      { type: "toolCall", id: "c2", toolName: "Bash", args: { command: "npm test" } },
    ];
    const rows = buildToolRows(parts);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      verbKey: "tool.verb.edit",
      title: "app.css",
      detail: "D:/x/src",
      filePath: "D:/x/src/app.css",
      additions: 3,
      deletions: 2,
      running: false,
      isError: false,
      resultText: "done",
      diff: { removed: "a\nb", added: "a\nc\nd" },
    });
    expect(rows[1]).toMatchObject({ verbKey: "tool.verb.bash", title: "npm test", running: true, command: "npm test" });
  });

  it("todo 行标题取 in_progress 项，detail 为完成计数", () => {
    const parts: MessagePart[] = [
      {
        type: "toolCall",
        id: "c1",
        toolName: "TodoWrite",
        args: {
          todos: [
            { content: "甲", status: "completed" },
            { content: "乙", status: "in_progress" },
          ],
        },
      },
    ];
    expect(buildToolRows(parts)[0]).toMatchObject({ verbKey: "tool.verb.todo", title: "乙", detail: "1/2" });
  });
});

describe("runToolsToTimelineRows", () => {
  it("面板轨迹行→时间线工具行：摘要作标题、未配对=运行中、result 作展开内容", () => {
    const rows = runToolsToTimelineRows([
      { name: "Grep", done: true, isError: false, title: "pairedRunTools", result: "无匹配", at: 1 },
      { name: "Read", done: false, title: "a.ts", at: 2 },
    ]);
    expect(rows[0]).toMatchObject({
      toolName: "Grep",
      verbKey: "tool.verb.grep",
      title: "pairedRunTools",
      running: false,
      isError: false,
      resultText: "无匹配",
    });
    expect(rows[1]).toMatchObject({ toolName: "Read", verbKey: "tool.verb.read", title: "a.ts", running: true, isError: false });
    expect("resultText" in rows[1]).toBe(false);
  });

  it("有 args 投影时复用 summarize()：文件路径/±diff 计数/展开明细全量产出", () => {
    const rows = runToolsToTimelineRows([
      {
        name: "Edit",
        done: true,
        isError: false,
        title: "a.ts",
        args: { file_path: "D:/x/src/a.ts", old_string: "a\nb", new_string: "a\nc\nd" },
        result: "done",
        at: 1,
      },
      { name: "Bash", done: false, args: { command: "npm test" }, at: 2 },
      {
        name: "TodoWrite",
        done: true,
        args: { todos: [{ content: "甲", status: "completed" }, { content: "乙", status: "in_progress" }] },
        at: 3,
      },
    ]);
    expect(rows[0]).toMatchObject({
      id: "run-tool-0",
      verbKey: "tool.verb.edit",
      title: "a.ts",
      detail: "D:/x/src",
      filePath: "D:/x/src/a.ts",
      additions: 3,
      deletions: 2,
      diff: { removed: "a\nb", added: "a\nc\nd" },
      running: false,
      resultText: "done",
    });
    expect(rows[1]).toMatchObject({ verbKey: "tool.verb.bash", title: "npm test", command: "npm test", running: true });
    expect(rows[2]).toMatchObject({
      verbKey: "tool.verb.todo",
      title: "乙",
      detail: "1/2",
      todos: [
        { content: "甲", status: "completed" },
        { content: "乙", status: "in_progress" },
      ],
    });
  });

  it("args 派生不出标题时回退轨迹摘要", () => {
    const rows = runToolsToTimelineRows([
      { name: "WebFetch", done: true, title: "example.test", args: { mode: "text" }, at: 1 },
    ]);
    expect(rows[0]).toMatchObject({ title: "example.test" });
  });
});

describe("latestTodos", () => {
  it("取最近一次 todo 工具调用，状态归一", () => {
    const messages = [
      {
        parts: [
          { type: "toolCall", id: "c1", toolName: "TodoWrite", args: { todos: [{ content: "旧", status: "pending" }] } },
        ] as MessagePart[],
      },
      {
        parts: [
          {
            type: "toolCall",
            id: "c2",
            toolName: "TodoWrite",
            args: {
              todos: [
                { content: "新-完成", status: "completed" },
                { content: "新-异常态", status: "weird" },
              ],
            },
          },
        ] as MessagePart[],
      },
    ];
    expect(latestTodos(messages)).toEqual([
      { content: "新-完成", status: "completed" },
      { content: "新-异常态", status: "pending" },
    ]);
  });

  it("没有 todo 调用时为空", () => {
    expect(latestTodos([{ parts: [{ type: "text", text: "x" }] as MessagePart[] }])).toEqual([]);
  });
});
