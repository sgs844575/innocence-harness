// @vitest-environment jsdom
// TerminalPanel：DockTerminalView 打桩；验证开合高度动画、首开自动建终端、
// ＋/X 标签管理、收合不卸载终端（shell 保活）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./DockTerminalView", () => ({
  DockTerminalView: (props: { terminalId: string; visible: boolean; fontFamily?: string | null }) => (
    <div
      data-testid="dtv"
      data-terminal={props.terminalId}
      data-visible={String(props.visible)}
      data-font-family={props.fontFamily ?? ""}
    />
  ),
}));

import { TerminalPanel } from "./TerminalPanel";

afterEach(cleanup);

const t = (key: string) => key;

const renderPanel = (open: boolean, onClose = () => {}) =>
  render(<TerminalPanel t={t} open={open} workspaceRoot="D:/AiProjects/InnocenceCode" onClose={onClose} />);

describe("TerminalPanel", () => {
  it("收合态高度 0 且无终端；打开自动建第一个终端（标题 = 目录名）", () => {
    const { rerender } = renderPanel(false);
    expect(screen.getByTestId("terminal-panel").style.height).toBe("0px");
    expect(screen.queryByTestId("dtv")).toBeNull();
    rerender(<TerminalPanel t={t} open workspaceRoot="D:/AiProjects/InnocenceCode" onClose={() => {}} />);
    expect(screen.getByTestId("terminal-panel").style.height).toBe("260px");
    expect(screen.getByTestId("dtv")).toBeTruthy();
    expect(screen.getByText("InnocenceCode")).toBeTruthy();
  });

  it("＋ 新建第二个终端并激活；标签 X 关闭单个终端", () => {
    renderPanel(true);
    fireEvent.click(screen.getByLabelText("terminal.new"));
    const views = screen.getAllByTestId("dtv");
    expect(views).toHaveLength(2);
    // 新终端为激活（visible），第一个隐藏但保持挂载。
    expect(views[0]!.getAttribute("data-visible")).toBe("false");
    expect(views[1]!.getAttribute("data-visible")).toBe("true");
    fireEvent.click(screen.getAllByLabelText("dock.closeTab")[0]!);
    expect(screen.getAllByTestId("dtv")).toHaveLength(1);
  });

  it("收合不卸载终端（重开仍在），面板 X 回调 onClose", () => {
    const onClose = vi.fn();
    const { rerender } = renderPanel(true, onClose);
    const firstId = screen.getByTestId("dtv").getAttribute("data-terminal");
    rerender(<TerminalPanel t={t} open={false} workspaceRoot="D:/AiProjects/InnocenceCode" onClose={onClose} />);
    expect(screen.getByTestId("terminal-panel").style.height).toBe("0px");
    // 收合后终端仍挂载（visible=false）
    expect(screen.getByTestId("dtv").getAttribute("data-terminal")).toBe(firstId);
    expect(screen.getByTestId("dtv").getAttribute("data-visible")).toBe("false");
    rerender(<TerminalPanel t={t} open workspaceRoot="D:/AiProjects/InnocenceCode" onClose={onClose} />);
    expect(screen.getByTestId("dtv").getAttribute("data-terminal")).toBe(firstId);
    fireEvent.click(screen.getByLabelText("terminal.close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("全部终端关完后给空态", () => {
    renderPanel(true);
    fireEvent.click(screen.getByLabelText("dock.closeTab"));
    expect(screen.getByText("terminal.empty")).toBeTruthy();
  });

  it("fontFamily 透传给每个终端视图；缺省为空（沿用 token 默认）", () => {
    const { rerender } = render(
      <TerminalPanel t={t} open workspaceRoot="D:/AiProjects/InnocenceCode" fontFamily="Panel Mono" onClose={() => {}} />,
    );
    expect(screen.getByTestId("dtv").getAttribute("data-font-family")).toBe("Panel Mono");
    rerender(<TerminalPanel t={t} open workspaceRoot="D:/AiProjects/InnocenceCode" onClose={() => {}} />);
    expect(screen.getByTestId("dtv").getAttribute("data-font-family")).toBe("");
  });
});
