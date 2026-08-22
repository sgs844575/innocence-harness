// @vitest-environment jsdom
// 技能分区测试：发现列表渲染（名称/描述/来源徽标）、导入按钮触发
// skills:import、导入成功反馈与清单重拉、已导入条目不可重复导入、失败反馈。
// 并列 MCP 块：发现提示渲染（.mcp.json 存在时）、导入触发与 imported/skipped
// 反馈、未发现时整块不渲染、损坏配置错误降级提示。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredSkillMirror } from "../../../../shared/ipc";
import { createT } from "../../lib/i18n";
import { SkillsSection } from "./SkillsSection";

vi.mock("../../lib/ipc", () => ({
  api: { discoverSkills: vi.fn(), importSkill: vi.fn(), discoverMcpFile: vi.fn(), importMcpServers: vi.fn() },
}));

import { api } from "../../lib/ipc";

const apiMock = api as unknown as {
  discoverSkills: ReturnType<typeof vi.fn>;
  importSkill: ReturnType<typeof vi.fn>;
  discoverMcpFile: ReturnType<typeof vi.fn>;
  importMcpServers: ReturnType<typeof vi.fn>;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const t = createT("zh-CN");

const LIST: DiscoveredSkillMirror[] = [
  { name: "review", description: "审查指南", sourceDir: "D:/a/review", origin: "external-a", imported: false },
  { name: "lint", description: "检查", sourceDir: "D:/b/lint", origin: "external-b", imported: true },
];

function mount(workspaceRoot = "D:\\proj"): ReturnType<typeof render> {
  return render(<SkillsSection t={t} workspaceRoot={workspaceRoot} />);
}

describe("SkillsSection", () => {
  it("渲染发现列表（名称/描述/来源徽标/已导入徽标）", async () => {
    apiMock.discoverSkills.mockResolvedValueOnce(LIST);
    apiMock.discoverMcpFile.mockResolvedValue(null);
    mount();
    expect(await screen.findByText("review")).toBeTruthy();
    expect(screen.getByText("审查指南")).toBeTruthy();
    expect(screen.getByText("外部目录 A")).toBeTruthy();
    expect(screen.getByText("外部目录 B")).toBeTruthy();
    expect(screen.getByText("已导入")).toBeTruthy();
  });

  it("导入按钮触发 import 并展示成功反馈与重拉清单", async () => {
    apiMock.discoverSkills
      .mockResolvedValueOnce([LIST[0]])
      .mockResolvedValueOnce([{ ...LIST[0], imported: true }]);
    apiMock.importSkill.mockResolvedValueOnce(undefined);
    apiMock.discoverMcpFile.mockResolvedValue(null);
    mount();
    const btn = await screen.findByRole("button", { name: "导入" });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(apiMock.importSkill).toHaveBeenCalledWith(LIST[0]);
    });
    expect(await screen.findByText(/已导入技能 review/)).toBeTruthy();
    // 重拉后条目呈已导入态（无导入按钮）。
    await waitFor(() => {
      expect(screen.getByText("已导入")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "导入" })).toBeNull();
    });
  });

  it("导入失败展示错误反馈", async () => {
    apiMock.discoverSkills.mockResolvedValue([LIST[0]]);
    apiMock.importSkill.mockRejectedValueOnce(new Error("boom"));
    apiMock.discoverMcpFile.mockResolvedValue(null);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "导入" }));
    expect(await screen.findByText(/导入 review 失败/)).toBeTruthy();
  });

  it("空清单显示空态文案", async () => {
    apiMock.discoverSkills.mockResolvedValue([]);
    apiMock.discoverMcpFile.mockResolvedValue(null);
    mount();
    expect(await screen.findByText("未发现可导入的技能")).toBeTruthy();
  });
});

describe("MCP 并列块", () => {
  it("发现 .mcp.json 时渲染提示与导入按钮；点击触发导入并展示 imported/skipped 反馈", async () => {
    apiMock.discoverSkills.mockResolvedValue([]);
    apiMock.discoverMcpFile.mockResolvedValue("D:\\proj\\.mcp.json");
    apiMock.importMcpServers.mockResolvedValueOnce({
      imported: ["alpha", "beta"],
      skipped: [{ name: "dup", reason: "duplicate" }],
    });
    mount();
    expect(await screen.findByText("外部 MCP 配置")).toBeTruthy();
    expect(screen.getByText(/D:\\proj\\.mcp\.json/)).toBeTruthy();
    // 技能列表为空 + MCP 块存在：区块按钮可寻址（与技能导入按钮区分）。
    const btn = screen.getByRole("button", { name: "导入" });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(apiMock.importMcpServers).toHaveBeenCalledWith("D:\\proj", "");
    });
    expect(await screen.findByText(/已导入 2 个服务器，跳过同名 1 个/)).toBeTruthy();
    expect(screen.getByText(/alpha, beta/)).toBeTruthy();
  });

  it("未发现 .mcp.json 时整块不渲染", async () => {
    apiMock.discoverSkills.mockResolvedValue([]);
    apiMock.discoverMcpFile.mockResolvedValue(null);
    mount();
    await screen.findByText("未发现可导入的技能");
    expect(screen.queryByTestId("mcp-import-block")).toBeNull();
    expect(screen.queryByText("外部 MCP 配置")).toBeNull();
  });

  it("导入失败（损坏配置）展示降级错误提示，不炸", async () => {
    apiMock.discoverSkills.mockResolvedValue([]);
    apiMock.discoverMcpFile.mockResolvedValue("D:\\proj\\.mcp.json");
    apiMock.importMcpServers.mockRejectedValueOnce(new Error("invalid mcp config"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "导入" }));
    expect(await screen.findByText(/导入 MCP 配置失败/)).toBeTruthy();
  });

  it("无工作区时整块不渲染", async () => {
    apiMock.discoverSkills.mockResolvedValue([]);
    apiMock.discoverMcpFile.mockResolvedValue("D:/x/.mcp.json");
    mount("");
    await screen.findByText("未发现可导入的技能");
    expect(apiMock.discoverMcpFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mcp-import-block")).toBeNull();
  });
});
