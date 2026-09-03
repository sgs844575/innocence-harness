import { describe, expect, it } from "vitest";
import { clipToolArgs, clipToolResult, summarizeToolTitle, TOOL_ARG_VALUE_LIMIT, TOOL_RESULT_EXCERPT_LIMIT } from "../src/tool-summary";

describe("summarizeToolTitle", () => {
  it("文件工具取路径基名（反斜杠归一）", () => {
    expect(summarizeToolTitle("Read", { file_path: "D:\\repo\\src\\a.ts" })).toBe("a.ts");
    expect(summarizeToolTitle("Edit", { path: "src/b/c.ts" })).toBe("c.ts");
  });

  it("搜索工具取 pattern/query（多行取首行）", () => {
    expect(summarizeToolTitle("Grep", { pattern: "reduceSubagentRuns" })).toBe("reduceSubagentRuns");
    expect(summarizeToolTitle("Glob", { pattern: "**/*.spec.ts" })).toBe("**/*.spec.ts");
    expect(summarizeToolTitle("Search", { query: "首行\n次行" })).toBe("首行");
  });

  it("终端工具取命令首行并截断超长值", () => {
    expect(summarizeToolTitle("Bash", { command: "npm test -- --run\nsecond line" })).toBe("npm test -- --run");
    const long = "x".repeat(200);
    expect(summarizeToolTitle("Bash", { command: long })).toBe(`${"x".repeat(120)}…`);
  });

  it("抓取类工具取 url；todo 工具取进行中事项", () => {
    expect(summarizeToolTitle("Fetch", { url: "https://example.test/a?b=1" })).toBe("https://example.test/a?b=1");
    expect(
      summarizeToolTitle("TodoWrite", {
        todos: [
          { content: "第一项", status: "completed" },
          { content: "第二项", status: "in_progress" },
        ],
      }),
    ).toBe("第二项");
  });

  it("task/agent 类工具取 description；其余无匹配返回 undefined", () => {
    expect(summarizeToolTitle("Task", { description: "定位渲染" })).toBe("定位渲染");
    expect(summarizeToolTitle("Something", { description: "不该命中" })).toBeUndefined();
    expect(summarizeToolTitle("Read", {})).toBeUndefined();
    expect(summarizeToolTitle("Read", undefined)).toBeUndefined();
  });
});

describe("clipToolResult", () => {
  it("空值透传 undefined；限长内原样；超长截断加省略号", () => {
    expect(clipToolResult(undefined)).toBeUndefined();
    expect(clipToolResult("")).toBeUndefined();
    expect(clipToolResult("短结果")).toBe("短结果");
    const long = "y".repeat(TOOL_RESULT_EXCERPT_LIMIT + 10);
    expect(clipToolResult(long)).toBe(`${"y".repeat(TOOL_RESULT_EXCERPT_LIMIT)}…`);
  });
});

describe("clipToolArgs", () => {
  it("浅拷贝：限长内原样，超长字符串值截断加省略号，非字符串原样保留", () => {
    const args = {
      file_path: "src/a.ts",
      content: "x".repeat(TOOL_ARG_VALUE_LIMIT + 10),
      todos: [{ content: "项", status: "pending" }],
      count: 3,
      flag: true,
    };
    const clipped = clipToolArgs(args);
    expect(clipped).toEqual({
      file_path: "src/a.ts",
      content: `${"x".repeat(TOOL_ARG_VALUE_LIMIT)}…`,
      todos: [{ content: "项", status: "pending" }],
      count: 3,
      flag: true,
    });
    // 返回新对象而不改入参。
    expect(clipped).not.toBe(args);
    expect(args.content).toHaveLength(TOOL_ARG_VALUE_LIMIT + 10);
  });
});
