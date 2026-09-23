import { describe, expect, it } from "vitest";
import {
  createTextToolCallGate,
  parseTextToolCalls,
  textToolCallTable,
} from "../src/index";
import type { ToolSpec } from "@innocenceharness/harness-providers";

const tools: ToolSpec[] = [
  {
    name: "Bash",
    description: "run",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        description: { type: "string" },
        timeout: { type: "integer" },
      },
    },
  },
  {
    name: "Read",
    description: "read",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        limit: { type: "integer" },
      },
    },
  },
];

const table = textToolCallTable(tools);

describe("parseTextToolCalls", () => {
  it("parses the inline function format with multiple parameters", () => {
    const text =
      '<tool_call><function=Bash><parameter=command>node a.js</parameter><parameter=description>run it</parameter></function></tool_call>';
    const calls = parseTextToolCalls(text, table);
    expect(calls).toEqual([
      {
        id: expect.stringMatching(/^textcall-/),
        toolName: "Bash",
        args: { command: "node a.js", description: "run it" },
      },
    ]);
  });

  it("parses parameters without a closing parameter tag", () => {
    // 无闭合 parameter：值取到 function 结束/块尾。
    const calls = parseTextToolCalls(
      "<tool_call><function=Bash><parameter=command>dir /b</function></tool_call>",
      table,
    );
    expect(calls?.[0]?.args).toEqual({ command: "dir /b" });
  });

  it("coerces numeric strings only for schema-typed parameters", () => {
    const calls = parseTextToolCalls(
      '<tool_call><function=Read><parameter=path>a.ts</parameter><parameter=limit>40</parameter></function></tool_call>',
      table,
    );
    expect(calls?.[0]?.args).toEqual({ path: "a.ts", limit: 40 });
    // 无类型声明的参数保持字符串。
    const loose = textToolCallTable([
      { name: "Bash", description: "", parameters: { type: "object", properties: {} } },
    ]);
    const calls2 = parseTextToolCalls(
      '<tool_call><function=Bash><parameter=command>123</parameter></function></tool_call>',
      loose,
    );
    expect(calls2?.[0]?.args).toEqual({ command: "123" });
  });

  it("parses the JSON body format including stringified arguments", () => {
    const calls = parseTextToolCalls(
      '<tool_call>\n{"name": "Bash", "arguments": {"command": "pwd"}}\n</tool_call>',
      table,
    );
    expect(calls?.[0]).toMatchObject({ toolName: "Bash", args: { command: "pwd" } });

    const calls2 = parseTextToolCalls(
      '<tool_call>{"name":"Bash","arguments":"{\\"command\\":\\"ls\\"}"}</tool_call>',
      table,
    );
    expect(calls2?.[0]?.args).toEqual({ command: "ls" });
  });

  it("parses the invoke format with child elements", () => {
    const calls = parseTextToolCalls(
      '<tool_call>\n<invoke name="Read">\n<file_path>src/a.ts</file_path>\n<limit>30</limit>\n</invoke>\n</tool_call>',
      table,
    );
    expect(calls?.[0]).toMatchObject({ toolName: "Read", args: { file_path: "src/a.ts", limit: 30 } });
  });

  it("parses multiple consecutive blocks", () => {
    const calls = parseTextToolCalls(
      '<tool_call><function=Read><parameter=path>a</parameter></function></tool_call>\n<tool_call><function=Read><parameter=path>b</parameter></function></tool_call>',
      table,
    );
    expect(calls).toHaveLength(2);
    expect(calls?.[1]?.args).toEqual({ path: "b" });
  });

  it("tolerates surrounding whitespace and unescapes entities", () => {
    const calls = parseTextToolCalls(
      '\n<tool_call><function=Bash><parameter=command>git log --grep=&quot;fix&quot; &amp;&amp; dir &lt;tmp&gt;</parameter></function></tool_call>\n',
      table,
    );
    expect(calls?.[0]?.args).toEqual({ command: 'git log --grep="fix" && dir <tmp>' });
  });

  it("keeps text when the tool name is not registered", () => {
    expect(
      parseTextToolCalls('<tool_call><function=Unknown><parameter=x>1</parameter></function></tool_call>', table),
    ).toBeNull();
  });

  it("keeps text when prose surrounds the block", () => {
    expect(
      parseTextToolCalls('Let me check.\n<tool_call><function=Bash><parameter=command>dir</parameter></function></tool_call>', table),
    ).toBeNull();
  });

  it("keeps text for plain prose or unrelated tags", () => {
    expect(parseTextToolCalls("Just an answer.", table)).toBeNull();
    expect(parseTextToolCalls("<tool_calls>something</tool_calls>", table)).toBeNull();
  });

  it("keeps text when a block is unclosed or unparsable", () => {
    expect(parseTextToolCalls("<tool_call><function=Bash><parameter=command>dir", table)).toBeNull();
    expect(parseTextToolCalls("<tool_call>garbage</tool_call>", table)).toBeNull();
    expect(parseTextToolCalls("<tool_call></tool_call>", table)).toBeNull();
  });
});

describe("createTextToolCallGate", () => {
  it("streams plain prose straight through", () => {
    const gate = createTextToolCallGate(table);
    expect(gate.pushText("Hello")).toBe("Hello");
    expect(gate.pushText(" world")).toBe(" world");
    expect(gate.finalize()).toEqual([]);
  });

  it("holds whitespace until the first non-space decides the mode", () => {
    const gate = createTextToolCallGate(table);
    expect(gate.pushText("\n\n")).toBeNull();
    expect(gate.pushText("Hi")).toBe("\n\nHi");
  });

  it("converts a markup message even when the opener is split across deltas", () => {
    const gate = createTextToolCallGate(table);
    for (const chunk of ["\n<tool_c", "all><func", "tion=Bash><parameter=command>", "dir /b", "</parameter></function></tool_call>"]) {
      expect(gate.pushText(chunk)).toBeNull();
    }
    const outputs = gate.finalize();
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({
      kind: "calls",
      calls: [expect.objectContaining({ toolName: "Bash", args: { command: "dir /b" } })],
    });
  });

  it("returns held text verbatim when conversion is impossible", () => {
    const gate = createTextToolCallGate(table);
    gate.pushText("<tool_call>not a real call");
    expect(gate.finalize()).toEqual([{ kind: "text", text: "<tool_call>not a real call" }]);
    expect(gate.finalize()).toEqual([]);
  });

  it("flushes held text on abort or error paths and is idempotent", () => {
    const gate = createTextToolCallGate(table);
    gate.pushText("<tool_call><function=Bash>");
    expect(gate.flushAsText()).toBe("<tool_call><function=Bash>");
    expect(gate.flushAsText()).toBeNull();
    expect(gate.finalize()).toEqual([]);
  });
});
