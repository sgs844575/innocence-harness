// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolGroupRow } from "./ToolGroupRow";
import { ToolTimeline } from "./ToolRow";
import type { ToolGroupingOptions } from "./toolGrouping";
import type { ToolRowModel } from "./toolRows";

afterEach(cleanup);

const labels: Record<string, string> = {
  "tool.group.explore": "探索",
  "tool.group.terminal": "终端",
  "tool.group.changes": "更改",
  "tool.group.expand": "展开{name}",
  "tool.group.collapse": "收起{name}",
};
const t = (key: string) => labels[key] ?? key;

const ALL_ON: ToolGroupingOptions = { explore: true, terminal: true, changes: true };

function row(overrides: Partial<ToolRowModel> & { id: string }): ToolRowModel {
  return { toolName: "Read", verbKey: "tool.verb.read", title: "", running: false, isError: false, ...overrides };
}

const reads: ToolRowModel[] = [
  row({ id: "r1", toolName: "Read", title: "a.ts", detail: "src" }),
  row({ id: "r2", toolName: "Grep", verbKey: "tool.verb.grep", title: "foo" }),
  row({ id: "r3", toolName: "Glob", verbKey: "tool.verb.glob", title: "*.ts" }),
];

describe("ToolGroupRow", () => {
  it("标题行：类别图标 + 英文类别名 + 行数，默认收起", () => {
    const { container } = render(
      <ToolGroupRow t={t} category="explore" count={3} running={false}>
        <div>rows</div>
      </ToolGroupRow>,
    );
    expect(screen.getByText("探索")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("false");
  });

  it("点击标题区展开手风琴渲染子行，chevron 同步开合", () => {
    const { container } = render(
      <ToolGroupRow t={t} category="terminal" count={2} running={false}>
        <div>inner rows</div>
      </ToolGroupRow>,
    );
    fireEvent.click(screen.getByTitle("终端 (2)"));
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("true");
    expect(screen.getByText("inner rows")).toBeTruthy();
    // chevron 钮收起
    fireEvent.click(screen.getByTitle("收起终端"));
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("false");
  });

  it("组内有运行中行时类别名走渐变文字", () => {
    const { container } = render(
      <ToolGroupRow t={t} category="changes" count={2} running>
        <div />
      </ToolGroupRow>,
    );
    expect(container.querySelector(".animated-gradient-text")?.textContent).toBe("更改");
  });
});

describe("ToolTimeline 分组", () => {
  it("连续读取/搜索行聚合为 Explore 组；展开后原行渲染且文件簇交互保留", () => {
    const onOpenFile = vi.fn();
    const fileRows = reads.map((r) => ({ ...r, filePath: `src/${r.title}` }));
    const { container } = render(<ToolTimeline t={t} rows={fileRows} grouping={ALL_ON} onOpenFile={onOpenFile} />);
    // 三行聚成一组：标题行可见，行内容收起。
    expect(screen.getByText("探索")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(container.querySelector(".acc-panel")?.getAttribute("data-open")).toBe("false");
    // 展开 → 原行（动词 + 文件名）逐行渲染。
    fireEvent.click(screen.getByTitle("探索 (3)"));
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("foo")).toBeTruthy();
    // 组内文件簇点击仍回传行模型（交互不受分组影响）。
    fireEvent.click(screen.getByTitle("src/a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith(fileRows[0]);
  });

  it("单行不成组；Task 子代理行不入组且整行点击直达面板", () => {
    const onOpenSubagent = vi.fn();
    const rows: ToolRowModel[] = [
      reads[0]!,
      row({ id: "k1", toolName: "Task", verbKey: "tool.verb.task", title: "定位渲染", invocationId: "inv-1" }),
      ...reads.slice(1),
    ];
    render(<ToolTimeline t={t} rows={rows} grouping={ALL_ON} onOpenSubagent={onOpenSubagent} />);
    // 首个 Read 单行不成组；Task 行打断后 r2/r3 聚成一组。
    expect(screen.getByText("tool.verb.read")).toBeTruthy();
    expect(screen.getByText("探索")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    fireEvent.click(screen.getByTitle("tool.task.openPanel"));
    expect(onOpenSubagent).toHaveBeenCalledWith({ invocationId: "inv-1", title: "定位渲染" });
  });

  it("terminal 组只收非只读命令；只读命令行独立平铺", () => {
    const rows: ToolRowModel[] = [
      row({ id: "s1", toolName: "Bash", verbKey: "tool.verb.bash", title: "npm test", command: "npm test" }),
      row({ id: "s2", toolName: "Bash", verbKey: "tool.verb.bash", title: "npm run build", command: "npm run build" }),
      row({ id: "s3", toolName: "Bash", verbKey: "tool.verb.bash", title: "ls", command: "ls" }),
    ];
    const { container } = render(<ToolTimeline t={t} rows={rows} grouping={ALL_ON} />);
    expect(screen.getByText("终端")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    // 只读 ls 行保持独立工具行（组外平铺；标题与收起态命令块各一处文本）。
    expect(screen.getAllByText("ls").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".group\\/tool-group")).toHaveLength(1);
    // 三行全渲染：组内两行 + 组外一行。
    expect(container.querySelectorAll(".group\\/tool-row")).toHaveLength(3);
  });

  it("类别设置关闭时不聚合；缺省 grouping = 平铺旧行为", () => {
    const { container: offContainer } = render(
      <ToolTimeline t={t} rows={reads} grouping={{ explore: false, terminal: true, changes: true }} />,
    );
    expect(screen.queryByText("探索")).toBeNull();
    expect(offContainer.querySelector(".group\\/tool-group")).toBeNull();
    cleanup();
    const { container } = render(<ToolTimeline t={t} rows={reads} />);
    expect(screen.queryByText("探索")).toBeNull();
    expect(container.querySelector(".group\\/tool-group")).toBeNull();
    expect(screen.getByText("a.ts")).toBeTruthy();
  });

  it("changes 组聚合连续写入/编辑行", () => {
    const rows: ToolRowModel[] = [
      row({ id: "w1", toolName: "Write", verbKey: "tool.verb.write", title: "a.ts", additions: 3, deletions: 0 }),
      row({ id: "w2", toolName: "Edit", verbKey: "tool.verb.edit", title: "b.ts", additions: 1, deletions: 1 }),
    ];
    render(<ToolTimeline t={t} rows={rows} grouping={ALL_ON} />);
    expect(screen.getByText("更改")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
