// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import type { HarnessSettings } from "../../../shared/ipc";

afterEach(cleanup);

const settings = {
  profiles: [{ id: "p1", name: "Provider", kind: "openai", apiKey: "", baseURL: "", enabled: true, models: [{ id: "model-1", source: "preset" }] }],
  activeProfileId: "p1",
  activeModel: "model-1",
  workspaceRoot: "D:/workspace",
  permissionMode: "full",
  reasoningEffort: "high",
} as unknown as HarnessSettings;
const t = (key: string) => key;

function renderComposer(extra: Partial<Parameters<typeof Composer>[0]> = {}) {
  return render(
    <Composer
      t={t}
      mode="existing"
      streaming={false}
      settings={settings}
      onPatchSettings={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      {...extra}
    />,
  );
}

describe("Composer", () => {
  it("回车发送并清空", () => {
    const onSend = vi.fn();
    renderComposer({ onSend });
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("landing 模式渲染 header 与落地 placeholder", () => {
    renderComposer({ mode: "landing", header: <button type="button">选择项目</button> });
    expect(screen.getByRole("button", { name: "选择项目" })).toBeTruthy();
    expect(screen.getByPlaceholderText("chat.placeholder")).toBeTruthy();
  });

  it("「+」菜单：附件禁用带原因，@ 项写入前导符", async () => {
    renderComposer();
    fireEvent.keyDown(screen.getByRole("button", { name: "composer.addContext" }), { key: "Enter" });
    const menu = await waitFor(() => screen.getByRole("menu"));
    const attachment = within(menu).getByRole("menuitem", { name: /composer.attach/ });
    expect(attachment.getAttribute("data-disabled")).not.toBeNull();
    expect(attachment.getAttribute("aria-description")).toMatch(/composer.attachUnavailable/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /chat.hint.at/ }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("@");
  });

  it("草稿注入：nonce 变化时替换文本", () => {
    const { rerender } = render(
      <Composer t={t} mode="landing" streaming={false} settings={settings} onPatchSettings={() => {}} onSend={() => {}} onStop={() => {}}
        draft={{ text: "模板一", nonce: 1 }} />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("模板一");
    rerender(
      <Composer t={t} mode="landing" streaming={false} settings={settings} onPatchSettings={() => {}} onSend={() => {}} onStop={() => {}}
        draft={{ text: "模板二", nonce: 2 }} />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("模板二");
  });

  it("流式时发送钮换成停止钮", () => {
    const onStop = vi.fn();
    renderComposer({ streaming: true, onStop });
    fireEvent.click(screen.getByRole("button", { name: "chat.stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "chat.send" })).toBeNull();
  });

  it("权限/模型/思考选择器齐全且走设置补丁", async () => {
    const onPatchSettings = vi.fn();
    renderComposer({ onPatchSettings });
    fireEvent.click(screen.getByRole("button", { name: /permission.mode/ }));
    fireEvent.click(screen.getByRole("button", { name: /permission.mode.auto/ }));
    expect(onPatchSettings).toHaveBeenCalledWith({ permissionMode: "auto" });
    expect(screen.getByRole("button", { name: /Provider \/ model-1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reasoning\.effort/ })).toBeTruthy();
  });

  it("Agent 模式选择器：选择写入设置补丁，条目带描述行", () => {
    const onPatchSettings = vi.fn();
    renderComposer({ onPatchSettings });
    fireEvent.click(screen.getByRole("button", { name: "agentMode" }));
    // 条目可访问名 = 标题 + 描述拼接（内置 id 的 i18n 键存在，t 透传键名）。
    fireEvent.click(screen.getByRole("button", { name: /agentMode\.default/ }));
    expect(onPatchSettings).toHaveBeenCalledWith({ activeAgentMode: "default" });
  });
});
