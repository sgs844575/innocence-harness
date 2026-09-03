// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightDock } from "./RightDock";
import {
  clampDockWidth,
  dockTabTitle,
  relativeTabTime,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  type DockTabInstance,
} from "../state/dockTabs";
import type { SubagentRun } from "../state/subagentRuns";

afterEach(cleanup);

const t = (key: string) => key;

const subagentsTab: DockTabInstance = { id: "subagents", kind: "subagents", createdAt: 1000 };
const auxTab: DockTabInstance = { id: "aux:sess1", kind: "aux", sessionId: "sess1", createdAt: 2000 };
const auxTab2: DockTabInstance = { id: "aux:sess2", kind: "aux", sessionId: "sess2", createdAt: 3000 };

const baseProps = {
  runs: [] as SubagentRun[],
  renderAuxTab: (tab: DockTabInstance) => <div data-testid="aux-stub">{tab.sessionId}</div>,
  renderReviewTab: () => <div data-testid="review-stub" />,
  renderTerminalTab: (tab: DockTabInstance) => <div data-testid="term-stub">{tab.id}</div>,
  renderBrowserTab: (tab: DockTabInstance) => <div data-testid="browser-stub">{tab.id}</div>,
  onActivateTab: () => {},
  onCloseTab: () => {},
  onNewTab: () => {},
};

const runningRun: SubagentRun = {
  childId: "c1",
  parentSessionId: "s1",
  parentInvocationId: "inv-1",
  agentType: "explore",
  description: "定位 Write 渲染",
  prompt: "去查代码",
  status: "running",
  text: "正在读取文件……",
  entries: [{ kind: "tool", tool: { name: "Read", phase: "call", at: 1100 } }],
  startedAt: 1000,
};

const doneRun: SubagentRun = {
  ...runningRun,
  childId: "c2",
  status: "completed",
  final: "结论全文",
  entries: [
    { kind: "tool", tool: { name: "Read", phase: "call", at: 1100 } },
    { kind: "tool", tool: { name: "Read", phase: "result", isError: false, at: 1200 } },
  ],
  endedAt: 5000,
};

describe("clampDockWidth / relativeTabTime / dockTabTitle", () => {
  it("宽度夹在最小/最大之间并取整", () => {
    expect(clampDockWidth(100)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(9999)).toBe(DOCK_MAX_WIDTH);
    expect(clampDockWidth(341.6)).toBe(342);
  });

  it("相对时间：刚刚 / N 分钟前 / HH:MM", () => {
    const now = 1_000_000_000_000;
    expect(relativeTabTime(t, now - 30_000, now)).toBe("dock.time.justNow");
    // identity t 无 {n} 占位可替换：校验 minutesAgo 键路径即可。
    expect(relativeTabTime(t, now - 5 * 60_000, now)).toBe("dock.time.minutesAgo");
    expect(relativeTabTime(t, 1000, now)).toBe(new Date(1000).toTimeString().slice(0, 5));
  });

  it("标签标题：子代理/审查用字典键；辅助对话按存活 aux 标签动态编号", () => {
    expect(dockTabTitle(t, subagentsTab, [subagentsTab])).toBe("dock.subagents");
    expect(dockTabTitle(t, { id: "review", kind: "review", createdAt: 1 }, [])).toBe("dock.tile.review");
    // 单个 aux 默认 1；两个并存按顺序 1/2；关掉第一个后第二个递补为 1。
    expect(dockTabTitle(t, auxTab, [auxTab])).toBe("dock.tile.chat 1");
    expect(dockTabTitle(t, auxTab, [auxTab, auxTab2])).toBe("dock.tile.chat 1");
    expect(dockTabTitle(t, auxTab2, [auxTab, auxTab2])).toBe("dock.tile.chat 2");
    expect(dockTabTitle(t, auxTab2, [auxTab2])).toBe("dock.tile.chat 1");
    // 终端标签用创建时固定的目录名标题，缺省回退字典键。
    expect(dockTabTitle(t, { id: "term_1", kind: "terminal", title: "InnocenceCode", createdAt: 1 }, [])).toBe("InnocenceCode");
    expect(dockTabTitle(t, { id: "term_2", kind: "terminal", createdAt: 2 }, [])).toBe("dock.tile.terminal");
  });

  it("标签标题：文件标签取路径末段，缺载荷回落字典键", () => {
    const fileTab: DockTabInstance = {
      id: "file:src/styles/app.css",
      kind: "file",
      file: { path: "src/styles/app.css" },
      createdAt: 1,
    };
    expect(dockTabTitle(t, fileTab, [fileTab])).toBe("app.css");
    expect(dockTabTitle(t, { id: "file:x", kind: "file", createdAt: 1 }, [])).toBe("dock.tile.file");
  });
});

describe("RightDock 首页（无激活标签）", () => {
  it("打开标签页：辅助对话/子代理/审查/终端/浏览器全部可用", () => {
    const onNewTab = vi.fn();
    render(<RightDock {...baseProps} t={t} tabs={[]} activeTabId={null} onNewTab={onNewTab} />);
    expect(screen.getByText("dock.home.title")).toBeTruthy();
    fireEvent.click(screen.getByText("dock.tile.chat"));
    expect(onNewTab).toHaveBeenCalledWith("aux");
    fireEvent.click(screen.getByText("dock.subagents"));
    expect(onNewTab).toHaveBeenCalledWith("subagents");
    fireEvent.click(screen.getByText("dock.tile.review"));
    expect(onNewTab).toHaveBeenCalledWith("review");
    fireEvent.click(screen.getByText("dock.tile.terminal"));
    expect(onNewTab).toHaveBeenCalledWith("terminal");
    fireEvent.click(screen.getByText("dock.tile.browser"));
    expect(onNewTab).toHaveBeenCalledWith("browser");
  });

  it("拖拽把手：pointerdown 回调给 App", () => {
    const onResizeStart = vi.fn();
    render(<RightDock {...baseProps} t={t} tabs={[]} activeTabId={null} onResizeStart={onResizeStart} />);
    fireEvent.pointerDown(screen.getByTestId("right-dock-resize-handle"), { clientX: 500 });
    expect(onResizeStart).toHaveBeenCalledOnce();
  });
});

describe("RightDock 标签条", () => {
  it("chip 横排：点击激活、X 关闭", () => {
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();
    render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab, auxTab]} activeTabId="subagents"
        onActivateTab={onActivateTab} onCloseTab={onCloseTab} />,
    );
    fireEvent.click(screen.getByText("dock.tile.chat 1"));
    expect(onActivateTab).toHaveBeenCalledWith("aux:sess1");
    fireEvent.click(screen.getAllByLabelText("dock.closeTab")[0]!);
    expect(onCloseTab).toHaveBeenCalledWith("subagents");
  });

  it("ˇ 弹出打开的标签页列表：搜索过滤、点击激活、行内 X 关闭", () => {
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();
    render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab, auxTab]} activeTabId="subagents"
        onActivateTab={onActivateTab} onCloseTab={onCloseTab} />,
    );
    fireEvent.click(screen.getByLabelText("dock.tabs.open"));
    // 两行都在（带相对时间），搜索 "chat" 后只剩辅助对话行
    expect(screen.getAllByText("dock.tile.chat 1").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("dock.tabs.search"), { target: { value: "chat" } });
    expect(screen.queryByText("dock.subagents", { selector: "li span" })).toBeNull();
    const row = screen.getByText("dock.tile.chat 1", { selector: "li span" });
    fireEvent.click(row);
    expect(onActivateTab).toHaveBeenCalledWith("aux:sess1");
  });

  it("＋ 弹出类型菜单：五种类型全部可开", () => {
    const onNewTab = vi.fn();
    render(<RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents" onNewTab={onNewTab} />);
    fireEvent.click(screen.getByLabelText("dock.home.title"));
    fireEvent.click(screen.getByText("dock.tile.browser"));
    expect(onNewTab).toHaveBeenCalledWith("browser");
  });
});

describe("RightDock 子代理标签", () => {
  it("空态文案", () => {
    render(<RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents" />);
    expect(screen.getByText("dock.empty")).toBeTruthy();
  });

  it("列表视图：预设徽章 + 描述 + 状态与时长 + 尾部预览 + 活跃计数", () => {
    const { container } = render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents" runs={[runningRun]} />,
    );
    expect(screen.getByText("explore")).toBeTruthy();
    expect(screen.getByText("定位 Write 渲染")).toBeTruthy();
    expect(screen.getByText(/dock\.status\.running/)).toBeTruthy();
    expect(container.querySelector(".line-clamp-2")?.textContent).toContain("正在读取文件");
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("列表主视图：只展示进行中的子代理（倒序），终态全部收进「查看全部」行", () => {
    const oldRunning: SubagentRun = { ...runningRun, childId: "c_older", description: "较早存活", startedAt: 1000 };
    const newRunning: SubagentRun = { ...runningRun, childId: "c_newer", description: "较新存活", startedAt: 2000 };
    const oldDone: SubagentRun = { ...doneRun, childId: "d_older", description: "较早完成", startedAt: 3000 };
    const newFailed: SubagentRun = {
      ...doneRun,
      childId: "d_newer",
      description: "较新失败",
      status: "failed",
      final: undefined,
      error: "出错了",
      startedAt: 4000,
    };
    render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents"
        runs={[oldRunning, oldDone, newRunning, newFailed]} />,
    );
    expect(screen.getByText("dock.subagents.runningGroup")).toBeTruthy();
    // 终态不出现在主列表，也不出该组标题。
    expect(screen.queryByText("dock.subagents.completedGroup")).toBeNull();
    expect(screen.queryByText("较早完成")).toBeNull();
    expect(screen.queryByText("较新失败")).toBeNull();
    // 组内倒序：较新存活在较早存活之前。
    const order = [screen.getByText("较新存活"), screen.getByText("较早存活")];
    expect(order[0]!.compareDocumentPosition(order[1]!) & 4).toBeTruthy();
    // 「查看全部」行携带终态计数 2。
    const viewAll = screen.getByRole("button", { name: /dock\.subagents\.viewAll/ });
    expect(viewAll.textContent).toContain("2");
  });

  it("「查看全部」进入归档视图：终态倒序（含各自状态标），返回钮回主列表", () => {
    const onSubagentsArchive = vi.fn();
    const oldDone: SubagentRun = { ...doneRun, childId: "d_older", description: "较早完成", startedAt: 3000 };
    const newFailed: SubagentRun = {
      ...doneRun,
      childId: "d_newer",
      description: "较新失败",
      status: "failed",
      final: undefined,
      error: "出错了",
      startedAt: 4000,
    };
    const { rerender } = render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents"
        runs={[runningRun, oldDone, newFailed]} subagentsArchive={false} onSubagentsArchive={onSubagentsArchive} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dock\.subagents\.viewAll/ }));
    expect(onSubagentsArchive).toHaveBeenCalledWith(true);
    // 归档视图：终态倒序（新→旧），失败/完成各自状态标在行内。
    rerender(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents"
        runs={[runningRun, oldDone, newFailed]} subagentsArchive onSubagentsArchive={onSubagentsArchive} />,
    );
    expect(screen.getByText("dock.subagents.completedGroup")).toBeTruthy();
    // 主列表的运行组标题不再渲染（归档视图不混排存活行）。
    expect(screen.queryByText("dock.subagents.runningGroup")).toBeNull();
    expect(screen.queryByText("定位 Write 渲染")).toBeNull();
    const order = [screen.getByText("较新失败"), screen.getByText("较早完成")];
    expect(order[0]!.compareDocumentPosition(order[1]!) & 4).toBeTruthy();
    expect(screen.getByText(/dock\.status\.failed/)).toBeTruthy();
    expect(screen.getByText(/dock\.status\.completed/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("dock.back"));
    expect(onSubagentsArchive).toHaveBeenCalledWith(false);
  });

  it("主列表无进行中运行时给空态提示；完全无运行给整体空态", () => {
    const { rerender } = render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents" runs={[doneRun]} />,
    );
    // 只有终态：主列表空态提示 + 「查看全部」入口。
    expect(screen.getByText("dock.subagents.liveEmpty")).toBeTruthy();
    expect(screen.getByRole("button", { name: /dock\.subagents\.viewAll/ })).toBeTruthy();
    rerender(<RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents" runs={[]} />);
    // 完全无运行：整体空态，无「查看全部」。
    expect(screen.getByText("dock.empty")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /dock\.subagents\.viewAll/ })).toBeNull();
  });

  it("点击卡片进入对话视图；对话视图含 Markdown 正文 + prompt + 工具轨迹，返回钮回列表", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents"
        runs={[doneRun]} selectedChildId="c2" onSelect={onSelect} />,
    );
    expect(container.textContent).toContain("结论全文");
    expect(screen.getByText("去查代码")).toBeTruthy();
    // 工具轨迹动词走 i18n（verbKeyFor），不再裸显原始工具名。
    expect(screen.getByText("tool.verb.read")).toBeTruthy();
    expect(screen.queryByText("Read")).toBeNull();
    fireEvent.click(screen.getByLabelText("dock.back"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("工具轨迹：动词 + 参数摘要；点击行展开结果摘录", () => {
    const run: SubagentRun = {
      ...doneRun,
      entries: [
        { kind: "tool", tool: { name: "Grep", phase: "call", title: "pairedRunTools", at: 1100 } },
        { kind: "tool", tool: { name: "Grep", phase: "result", isError: false, result: "src/a.ts:10", at: 1200 } },
      ],
    };
    render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents" runs={[run]} selectedChildId="c2" />,
    );
    expect(screen.getByText("tool.verb.grep")).toBeTruthy();
    expect(screen.getByText("pairedRunTools")).toBeTruthy();
    // acc-panel 为 CSS 高度动画（内容常驻 DOM），展开态经 aria-expanded 断言；
    // 结果摘录在 DOM 中且点击后行进入展开态。
    const row = screen.getByRole("button", { name: /tool\.verb\.grep/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("src/a.ts:10")).toBeTruthy();
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
  });

  it("对话视图与主聊天同语言：思考幽灵行 + 等待行 + prompt hover 复制", () => {
    const thinkingRun: SubagentRun = {
      ...runningRun,
      text: "",
      entries: [{ kind: "thinking", text: "先看入口" }],
    };
    const { rerender } = render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents" runs={[thinkingRun]} selectedChildId="c1" />,
    );
    // 运行中无正文：thinking 幽灵行 live（渐变「正在思考」+ 尾随预览；
    // 预览与展开全文常驻 DOM，用 getAllByText 断言存在）。
    expect(screen.getByText("chat.thinking.live")).toBeTruthy();
    expect(screen.getAllByText(/先看入口/).length).toBeGreaterThan(0);
    // prompt 用户气泡渲染，hover 复制钮存在（aria-label 用 chat.copy 键）。
    expect(screen.getByText("去查代码")).toBeTruthy();
    expect(screen.getByLabelText("chat.copy")).toBeTruthy();
    rerender(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents"
        runs={[{ ...runningRun, entries: [], text: "" }]} selectedChildId="c1" />,
    );
    // 无思考无工具无正文的空等：轮换耐心提示的等待行。
    expect(screen.getByTestId("chat-waiting")).toBeTruthy();
  });

  it("思考分段：工具活动打断的思考各成幽灵行，与工具组按事件顺序穿插", () => {
    const run: SubagentRun = {
      ...doneRun,
      entries: [
        { kind: "thinking", text: "第一段思考" },
        { kind: "tool", tool: { name: "Read", phase: "call", at: 1100 } },
        { kind: "tool", tool: { name: "Read", phase: "result", isError: false, at: 1200 } },
        { kind: "thinking", text: "第二段思考" },
      ],
    };
    render(<RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents" runs={[run]} selectedChildId="c2" />);
    // 已完成：两段思考各渲染一行「思考」标签（不再并成一行）。
    const labels = screen.getAllByText("chat.thinking.label");
    expect(labels.length).toBe(2);
    // 顺序：段一 → 工具动词 → 段二（文档顺序断言穿插关系）。
    const order = [screen.getAllByText("第一段思考")[0]!, screen.getByText("tool.verb.read"), screen.getAllByText("第二段思考")[0]!];
    for (let index = 0; index < order.length - 1; index += 1) {
      expect(order[index]!.compareDocumentPosition(order[index + 1]!) & 4).toBeTruthy();
    }
  });

  it("对话视图失败态：错误块 + 失败状态", () => {
    const { container } = render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents"
        runs={[{ ...doneRun, childId: "c3", status: "failed", final: undefined, error: "模型失败" }]}
        selectedChildId="c3" />,
    );
    expect(container.textContent).toContain("模型失败");
    expect(screen.getByText(/dock\.status\.failed/)).toBeTruthy();
  });

  it("selectedChildId 无匹配运行时回落到列表主视图", () => {
    render(
      <RightDock {...baseProps} t={t} tabs={[subagentsTab]} activeTabId="subagents"
        runs={[runningRun]} selectedChildId="missing" />,
    );
    expect(screen.getByText("定位 Write 渲染")).toBeTruthy();
    expect(screen.queryByLabelText("dock.back")).toBeNull();
  });
});

describe("RightDock 辅助对话标签", () => {
  it("经 renderAuxTab 注入会话内容", () => {
    render(<RightDock {...baseProps} t={t} tabs={[auxTab]} activeTabId="aux:sess1" />);
    expect(screen.getByTestId("aux-stub").textContent).toBe("sess1");
  });
});

describe("RightDock 审查标签", () => {
  it("经 renderReviewTab 注入审查内容", () => {
    render(
      <RightDock {...baseProps} t={t}
        tabs={[{ id: "review", kind: "review", createdAt: 1 }]} activeTabId="review" />,
    );
    expect(screen.getByTestId("review-stub")).toBeTruthy();
  });
});

describe("RightDock 文件标签", () => {
  const diffTab: DockTabInstance = {
    id: "file:src/styles/app.css",
    kind: "file",
    file: { path: "src/styles/app.css", diff: { removed: "旧行", added: "新行" } },
    createdAt: 1,
  };

  it("修改内容载荷：路径头 + 红绿 diff 行块", () => {
    const { container } = render(<RightDock {...baseProps} t={t} tabs={[diffTab]} activeTabId={diffTab.id} />);
    expect(screen.getByTitle("src/styles/app.css")).toBeTruthy();
    expect(screen.getByText("旧行")).toBeTruthy();
    expect(screen.getByText("新行")).toBeTruthy();
    expect(container.querySelector(".diff-line-del")).toBeTruthy();
    expect(container.querySelector(".diff-line-add")).toBeTruthy();
  });

  it("原文载荷：渲染读取结果；空载荷给「无输出」", () => {
    const textTab: DockTabInstance = {
      id: "file:src/a.ts",
      kind: "file",
      file: { path: "src/a.ts", originalText: "文件正文" },
      createdAt: 2,
    };
    const { rerender } = render(<RightDock {...baseProps} t={t} tabs={[textTab]} activeTabId={textTab.id} />);
    expect(screen.getByText("文件正文")).toBeTruthy();
    rerender(
      <RightDock {...baseProps} t={t}
        tabs={[{ id: "file:src/b.ts", kind: "file", file: { path: "src/b.ts" }, createdAt: 3 }]}
        activeTabId="file:src/b.ts" />,
    );
    expect(screen.getByText("tool.status.empty")).toBeTruthy();
  });
});

describe("RightDock 终端标签", () => {
  const terminalTab: DockTabInstance = { id: "term_1", kind: "terminal", title: "InnocenceCode", cwd: "D:/proj", createdAt: 4 };

  it("经 renderTerminalTab 注入终端内容；标题取目录名", () => {
    render(<RightDock {...baseProps} t={t} tabs={[terminalTab]} activeTabId="term_1" />);
    expect(screen.getByTestId("term-stub")).toBeTruthy();
    expect(screen.getAllByText("InnocenceCode").length).toBeGreaterThan(0);
  });

  it("aux/terminal 标签常驻挂载：非激活仅隐藏，内容不卸载", () => {
    const { rerender } = render(
      <RightDock {...baseProps} t={t} tabs={[auxTab, terminalTab]} activeTabId="aux:sess1" />,
    );
    // 两个内容都在文档中（常驻），终端容器隐藏。
    const termStub = screen.getByTestId("term-stub");
    const auxStub = screen.getByTestId("aux-stub");
    expect(termStub.parentElement?.className).toContain("hidden");
    expect(auxStub.parentElement?.className).not.toContain("hidden");
    // 切到终端标签：可见性翻转，两者仍挂载。
    rerender(<RightDock {...baseProps} t={t} tabs={[auxTab, terminalTab]} activeTabId="term_1" />);
    expect(screen.getByTestId("term-stub").parentElement?.className).not.toContain("hidden");
    expect(screen.getByTestId("aux-stub").parentElement?.className).toContain("hidden");
  });
});

describe("RightDock 浏览器标签", () => {
  const browserTab: DockTabInstance = { id: "browser_1", kind: "browser", title: "示例页", createdAt: 5 };

  it("经 renderBrowserTab 注入内容；标题取页面回写值", () => {
    render(<RightDock {...baseProps} t={t} tabs={[browserTab]} activeTabId="browser_1" />);
    expect(screen.getByTestId("browser-stub")).toBeTruthy();
    expect(screen.getAllByText("示例页").length).toBeGreaterThan(0);
  });

  it("favicon 存在时 chip 显示图标图片", () => {
    const { container } = render(
      <RightDock {...baseProps} t={t}
        tabs={[{ ...browserTab, favicon: "data:image/png;base64,x" }]} activeTabId="browser_1" />,
    );
    expect(container.querySelector("img[src^='data:image']")).toBeTruthy();
  });

  it("非激活浏览器标签用 invisible 常驻（不卸载访客插件）", () => {
    render(<RightDock {...baseProps} t={t} tabs={[auxTab, browserTab]} activeTabId="aux:sess1" />);
    const wrapper = screen.getByTestId("browser-stub").parentElement!;
    expect(wrapper.className).toContain("invisible");
    expect(wrapper.className).not.toContain("hidden");
  });
});
