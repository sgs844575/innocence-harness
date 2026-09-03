// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolRow } from "./ToolRow";
import type { ToolRowModel } from "./toolRows";

afterEach(cleanup);

const t = (key: string) => key;

const editRow: ToolRowModel = {
  id: "c1",
  toolName: "Edit",
  verbKey: "tool.verb.edit",
  title: "app.css",
  detail: "src/styles",
  additions: 2,
  deletions: 1,
  running: false,
  isError: false,
  resultText: "done",
  diff: { removed: "old line", added: "new line\nnewer line" },
};

describe("ToolRow", () => {
  it("完成态：动词 + 文件名 + ±计数，chevron 悬停显现", () => {
    const { container } = render(<ToolRow t={t} row={editRow} />);
    expect(screen.getByText("tool.verb.edit")).toBeTruthy();
    expect(screen.getByText("app.css")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
    expect(container.querySelector(".group\\/tool-summary")).toBeTruthy();
  });

  it("展开渲染红绿 diff 行", () => {
    const { container } = render(<ToolRow t={t} row={editRow} />);
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("false");
    // 主按钮（动词区）点击同样切换下拉。
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("true");
    expect(screen.getByText("old line")).toBeTruthy();
    expect(screen.getByText("newer line")).toBeTruthy();
    expect(container.querySelector(".diff-line-del")).toBeTruthy();
    expect(container.querySelector(".diff-line-add")).toBeTruthy();
    // diff 块限高自滚动（长写入不撑爆时间线）。
    expect(screen.getByText("old line").closest(".overflow-auto")?.className).toContain("max-h-60");
    // 不显示参数块
    expect(screen.queryByText("tool.params")).toBeNull();
  });

  it("运行中动词为渐变文字", () => {
    const { container } = render(<ToolRow t={t} row={{ ...editRow, running: true, diff: undefined, resultText: undefined }} />);
    expect(container.querySelector(".animated-gradient-text")).toBeTruthy();
  });

  it("失败态显示虚线下划线的状态文案", () => {
    render(<ToolRow t={t} row={{ ...editRow, isError: true, diff: undefined, resultText: "boom" }} />);
    const status = screen.getByText("tool.status.failed");
    expect(status.className).toContain("decoration-dotted");
  });

  it("Read 行同样可展开查看结果", () => {
    const { container } = render(
      <ToolRow t={t} row={{ ...editRow, verbKey: "tool.verb.read", diff: undefined, resultText: "file body" }} />,
    );
    fireEvent.click(screen.getByTitle("tool.preview"));
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("true");
    expect(screen.getByText("file body")).toBeTruthy();
  });

  it("终端行展开为命令 + 输出卡", () => {
    render(
      <ToolRow
        t={t}
        row={{
          id: "c2",
          toolName: "Bash",
          verbKey: "tool.verb.bash",
          title: "npm test",
          command: "npm test",
          running: false,
          isError: false,
          resultText: "all green",
        }}
      />,
    );
    fireEvent.click(screen.getByTitle("tool.preview"));
    expect(screen.getByText("npm test", { selector: "pre" })).toBeTruthy();
    expect(screen.getByText("all green")).toBeTruthy();
  });

  it("子代理行（带 invocationId + onOpenSubagent）整行点击直达面板，无下拉展开", () => {
    const onOpenSubagent = vi.fn();
    const { container } = render(
      <ToolRow
        t={t}
        row={{
          id: "c3",
          toolName: "Task",
          verbKey: "tool.verb.task",
          title: "定位渲染",
          invocationId: "inv-9",
          running: true,
          isError: false,
          resultText: "不应出现在时间线",
        }}
        onOpenSubagent={onOpenSubagent}
      />,
    );
    // 主按钮即面板入口（title 提示），点击回传定位线索（关联键+标题+结果文本），不渲染下拉区。
    fireEvent.click(screen.getByTitle("tool.task.openPanel"));
    expect(onOpenSubagent).toHaveBeenCalledWith({
      invocationId: "inv-9",
      title: "定位渲染",
      resultText: "不应出现在时间线",
    });
    expect(container.querySelector(".acc-panel")).toBeNull();
    expect(screen.queryByText("不应出现在时间线")).toBeNull();
  });

  it("缺 invocationId 的子代理行（旧记录）同样可点击：回传标题/结果文本线索，无下拉无结果块", () => {
    const onOpenSubagent = vi.fn();
    const { container } = render(
      <ToolRow
        t={t}
        row={{
          id: "c4",
          toolName: "Task",
          verbKey: "tool.verb.task",
          title: "旧记录",
          running: false,
          isError: false,
          resultText: "历史结论",
        }}
        onOpenSubagent={onOpenSubagent}
      />,
    );
    fireEvent.click(screen.getByTitle("tool.task.openPanel"));
    expect(onOpenSubagent).toHaveBeenCalledWith({ title: "旧记录", resultText: "历史结论" });
    expect(screen.queryByTitle("tool.preview")).toBeNull();
    expect(container.querySelector(".acc-panel")).toBeNull();
    expect(screen.queryByText("历史结论")).toBeNull();
  });

  it("有 invocationId 即面板入口（档案缺失也不退化为可展开行）", () => {
    const onOpenSubagent = vi.fn();
    const { container } = render(
      <ToolRow
        t={t}
        row={{
          id: "c5",
          toolName: "Task",
          verbKey: "tool.verb.task",
          title: "孤儿调用",
          invocationId: "inv-gone",
          running: false,
          isError: false,
          resultText: "落盘前的结论",
        }}
        onOpenSubagent={onOpenSubagent}
      />,
    );
    // 整行即面板入口，点击回传定位线索；不渲染下拉区与只读结果。
    fireEvent.click(screen.getByTitle("tool.task.openPanel"));
    expect(onOpenSubagent).toHaveBeenCalledWith({
      invocationId: "inv-gone",
      title: "孤儿调用",
      resultText: "落盘前的结论",
    });
    expect(container.querySelector(".acc-panel")).toBeNull();
    expect(screen.queryByText("落盘前的结论")).toBeNull();
  });

  it("非子代理行不渲染面板入口", () => {
    render(<ToolRow t={t} row={editRow} onOpenSubagent={() => {}} />);
    expect(screen.queryByTitle("tool.task.openPanel")).toBeNull();
  });

  it("文件行（带 onOpenFile）：文件簇点击回传行模型且不展开；chevron 走内联预览", () => {
    const onOpenFile = vi.fn();
    const fileRow: ToolRowModel = { ...editRow, filePath: "src/styles/app.css" };
    const { container } = render(<ToolRow t={t} row={fileRow} onOpenFile={onOpenFile} />);
    // 文件簇按钮（title = 完整路径）点击 → dock 打开，下拉保持关闭。
    fireEvent.click(screen.getByTitle("src/styles/app.css"));
    expect(onOpenFile).toHaveBeenCalledWith(fileRow);
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("false");
    // chevron 点击 → 现存内联预览，不再回传。
    fireEvent.click(screen.getByTitle("tool.preview"));
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("true");
    expect(screen.getByText("old line")).toBeTruthy();
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("文件行缺 onOpenFile 或 filePath 时文件簇留在主按钮内（无独立入口）", () => {
    render(<ToolRow t={t} row={editRow} />);
    expect(screen.queryByLabelText("tool.openFile")).toBeNull();
    render(<ToolRow t={t} row={{ ...editRow, filePath: "src/styles/app.css" }} />);
    expect(screen.queryByLabelText("tool.openFile")).toBeNull();
  });
});
