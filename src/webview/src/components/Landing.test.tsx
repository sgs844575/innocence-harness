// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Landing } from "./Landing";
import { GitCapsule } from "./GitCapsule";
import { zhCN } from "../lib/i18n";

afterEach(cleanup);

const t = (key: string) => zhCN[key] ?? key;

function renderLanding(extra: Partial<Parameters<typeof Landing>[0]> = {}) {
  return render(
    <Landing
      t={t}
      appName="InnocenceHarness"
      pendingProject=""
      branch={null}
      recentProjects={[]}
      onPickProject={() => {}}
      onOpenProjectDir={() => {}}
      settings={null}
      streaming={false}
      onPatchSettings={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      onQuickPick={() => {}}
      {...extra}
    />,
  );
}

describe("Landing", () => {
  it("时间问候语 + 输入卡 + 快捷动作 chips", () => {
    renderLanding();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent?.length).toBeGreaterThan(0);
    for (const label of ["周报总结", "报错修复", "PPT 制作", "闲时任务"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("快捷动作点击回调模板 prompt", () => {
    const onQuickPick = vi.fn();
    renderLanding({ onQuickPick });
    fireEvent.click(screen.getByRole("button", { name: /闲时任务/ }));
    expect(onQuickPick).toHaveBeenCalledWith(zhCN["chat.quick.idle.prompt"]);
  });

  it("选中 Git 项目时渲染分支胶囊", () => {
    renderLanding({ pendingProject: "D:/x/InnocenceCode", branch: "main" });
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("InnocenceCode")).toBeTruthy();
  });
});

describe("GitCapsule", () => {
  const data = {
    branch: "main",
    isGitRepo: true,
    changes: { changedFiles: 3, additions: 244, deletions: 22806 },
    todos: [
      { content: "重写底色 token", status: "completed" as const },
      { content: "同步 index.html", status: "in_progress" as const },
      { content: "类型检查", status: "pending" as const },
    ],
  };

  it("标题 Git 工具 + 更改计数 + 分支 + 进程清单（完成划线）", () => {
    render(<GitCapsule t={t} data={data} open onToggleOpen={() => {}} />);
    expect(screen.getByText("Git 工具")).toBeTruthy();
    expect(screen.getByText("+244")).toBeTruthy();
    expect(screen.getByText("−22806")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
    const done = screen.getByText("重写底色 token");
    expect(done.className).toContain("line-through");
  });

  it("折叠成图标胶囊后可再展开（受控开合 + 关闭过渡）", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return <GitCapsule t={t} data={data} open={open} onToggleOpen={setOpen} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "折叠活动胶囊" }));
    // 关闭过渡：面板播完 150ms 关闭动画后才换成芯片
    await waitFor(() => expect(screen.queryByText("main")).toBeNull());
    // 折叠后为「更改 +N −M」紧凑芯片（有更改数据时）
    expect(screen.getByText("更改")).toBeTruthy();
    expect(screen.getByText("+244")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开活动胶囊" }));
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
  });
});
