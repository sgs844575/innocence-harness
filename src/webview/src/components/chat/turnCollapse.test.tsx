// @vitest-environment jsdom
// 槽位环境接线：工具卡经槽位解析，测试内包 Provider + 内置注册。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TurnCollapse } from "./TurnCollapse";
import { BuiltinToolcards } from "./toolcards/builtinToolcards";
import { SlotProvider } from "../../slots/react";
import type { ToolCallPart, ToolResultPart } from "../../../../shared/ipc";

afterEach(cleanup);


const call: ToolCallPart = { type: "toolCall", id: "a", toolName: "Bash", args: { command: "ls" } };
const result: ToolResultPart = { type: "toolResult", toolCallId: "a", content: "x", isError: false, durationMs: 50 };


describe("TurnCollapse（工具时间线）", () => {
  it("工具行直接平铺可见，点击行展开明细", () => {
    render(
      <SlotProvider>
        <BuiltinToolcards />
        <TurnCollapse parts={[call, result]} />
      </SlotProvider>,
    );
    // 参考稿语言：每个动作一行，不再折叠成组——命令直接可见
    expect(screen.getByText("ls")).toBeTruthy();
    // 明细默认收起：输出内容不可见，点击行后展开
    expect(screen.queryByText("x")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /终端/ }));
    expect(screen.getByText("x")).toBeTruthy();
  });
  it("流式态行同样直接可见", () => {
    render(
      <SlotProvider>
        <BuiltinToolcards />
        <TurnCollapse parts={[call]} />
      </SlotProvider>,
    );
    expect(screen.getByText(/ls/)).toBeTruthy();
  });
});
