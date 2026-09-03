// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessSettings } from "../../../../shared/ipc";
import { ModelsPanel } from "./ModelsPanel";

afterEach(cleanup);

const t = (key: string) => key;

const baseSettings = {
  profiles: [
    {
      id: "p1",
      name: "智谱开放平台",
      kind: "openai",
      apiKey: "",
      apiKeyConfigured: true,
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      enabled: true,
      models: [{ id: "glm-4.6", name: "glm-4.6", source: "preset" }],
    },
  ],
  activeProfileId: "p1",
  activeModel: "glm-4.6",
  workspaceRoot: "",
  permissionMode: "ask",
} as unknown as HarnessSettings;

function renderPanel(extra: Partial<Parameters<typeof ModelsPanel>[0]> = {}) {
  return render(
    <ModelsPanel t={t} settings={baseSettings} onPatchSettings={() => {}} {...extra} />,
  );
}

describe("ModelsPanel", () => {
  it("供应商列表 + 详情（名称/地址/密钥/模型行）", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /智谱开放平台/ })).toBeTruthy();
    expect(screen.getByDisplayValue("智谱开放平台")).toBeTruthy();
    expect(screen.getByDisplayValue("https://open.bigmodel.cn/api/paas/v4")).toBeTruthy();
    expect(screen.getByText("glm-4.6")).toBeTruthy();
  });

  it("停用供应商：补丁携带 providerProfiles 更新", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    fireEvent.click(screen.getByRole("switch", { name: "settings.models.enabled" }));
    expect(onPatchSettings).toHaveBeenCalledTimes(1);
    const patch = onPatchSettings.mock.calls[0]![0];
    expect(JSON.stringify(patch.providerProfiles)).toContain('"enabled":false');
  });

  it("弹窗添加模型（ID + 上下文窗口 + 图片输入）", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    fireEvent.click(screen.getByRole("button", { name: "settings.models.addModel" }));
    const dialog = screen.getByRole("dialog", { name: "settings.models.dialog.title" });
    fireEvent.change(screen.getByPlaceholderText("settings.models.dialog.modelId"), { target: { value: "glm-4.5-air" } });
    fireEvent.change(within(dialog).getByLabelText("settings.models.dialog.contextWindow"), { target: { value: "131072" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "settings.models.dialog.image" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "settings.models.save" }));
    const patch = onPatchSettings.mock.calls[0]![0];
    const text = JSON.stringify(patch.providerProfiles);
    expect(text).toContain("glm-4.5-air");
    expect(text).toContain('"contextWindow":131072');
    expect(text).toContain('"vision":true');
  });

  it("从预设添加供应商并选中", () => {
    const onPatchSettings = vi.fn();
    const { rerender } = renderPanel({ onPatchSettings });
    fireEvent.click(screen.getByRole("button", { name: /settings.models.addProvider/ }));
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek" }));
    const patch = onPatchSettings.mock.calls[0]![0];
    expect(JSON.stringify(patch.providerProfiles)).toContain("DeepSeek");
    // 宿主应用补丁后回推新设置（受控面板）：详情立即可见。
    const created = JSON.parse(JSON.stringify(patch.providerProfiles.updates[0].create));
    rerender(
      <ModelsPanel
        t={t}
        settings={{ ...baseSettings, profiles: [...baseSettings.profiles, created] }}
        onPatchSettings={onPatchSettings}
      />,
    );
    expect(screen.getByDisplayValue("DeepSeek")).toBeTruthy();
  });

  it("保存 API 密钥走 onSetApiKey", () => {
    const onSetApiKey = vi.fn();
    renderPanel({ onSetApiKey });
    const input = screen.getByLabelText("settings.models.apiKey");
    fireEvent.change(input, { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "settings.models.save" }));
    expect(onSetApiKey).toHaveBeenCalledWith("p1", "sk-test");
  });

  it("删除模型与供应商", () => {
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings });
    fireEvent.click(screen.getByRole("button", { name: /settings.models.deleteModel/ }));
    expect(JSON.stringify(onPatchSettings.mock.calls[0]![0].providerProfiles)).not.toContain("glm-4.6");
    fireEvent.click(screen.getByRole("button", { name: /settings.models.deleteProvider/ }));
    const last = onPatchSettings.mock.calls.at(-1)![0];
    expect(JSON.stringify(last.providerProfiles)).toContain('"removeIds":["p1"]');
  });

  it("拉取模型后弹勾选导入：默认上下文 1000000 / 输出 128000，已有 id 不再列出", async () => {
    const onFetchModels = vi.fn(async () => [
      { id: "glm-4.6", name: "glm-4.6", source: "fetch" as const },
      { id: "glm-5", name: "glm-5", source: "fetch" as const },
    ]);
    const onPatchSettings = vi.fn();
    renderPanel({ onPatchSettings, onFetchModels });
    fireEvent.click(screen.getByRole("button", { name: "settings.models.fetch" }));
    const dialog = await screen.findByRole("dialog", { name: "settings.models.import.title" });
    // 已存在的 glm-4.6 不再出现在候选里
    expect(within(dialog).queryByRole("checkbox", { name: "glm-4.6" })).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "glm-5" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /settings.models.import.action/ }));
    const text = JSON.stringify(onPatchSettings.mock.calls[0]![0].providerProfiles);
    expect(text).toContain("glm-5");
    expect(text).toContain('"contextWindow":1000000');
    expect(text).toContain('"maxOutput":128000');
  });
});
