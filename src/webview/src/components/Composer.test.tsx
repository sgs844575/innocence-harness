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
    expect(onSend).toHaveBeenCalledWith("hi", []);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("landing 模式渲染 header 与落地 placeholder", () => {
    renderComposer({ mode: "landing", header: <button type="button">选择项目</button> });
    expect(screen.getByRole("button", { name: "选择项目" })).toBeTruthy();
    expect(screen.getByPlaceholderText("chat.placeholder")).toBeTruthy();
  });

  it("「+」菜单：附件项可用（打开文件选择器），@ 项写入前导符", async () => {
    renderComposer();
    fireEvent.keyDown(screen.getByRole("button", { name: "composer.addContext" }), { key: "Enter" });
    const menu = await waitFor(() => screen.getByRole("menu"));
    const attachment = within(menu).getByRole("menuitem", { name: /^composer\.attach$/ });
    expect(attachment.getAttribute("data-disabled")).toBeNull();
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

  it("流式中回车仍可发送（主进程排队/引导），输入框清空", () => {
    const onSend = vi.fn();
    renderComposer({ streaming: true, onSend });
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: "后续消息" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("后续消息", []);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("流式中输入框有内容时动作钮仍是停止", () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    renderComposer({ streaming: true, onStop, onSend });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
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

// ---- @ 文件 / / 技能补全 ------------------------------------------------------

function mockSuggestBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    listAgentModes: vi.fn(async () => [{ id: "default", title: "Default" }]),
    onPluginsChanged: vi.fn(() => () => {}),
    listSkills: vi.fn(async () => [
      { name: "debugging", description: "systematic bug hunting" },
      { name: "verify", description: "verify before done" },
    ]),
    listWorkspaceFiles: vi.fn(async () => [
      "src/app/main.ts",
      "src/app/utils.ts",
      "docs/guide.md",
    ]),
    ...overrides,
  };
  (window as unknown as { innocencecode: unknown }).innocencecode = bridge;
  return bridge as typeof bridge & Record<string, unknown>;
}

function typeInto(ta: HTMLTextAreaElement, text: string): void {
  fireEvent.change(ta, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } });
}

describe("Composer 补全弹层", () => {
  it("输入 @ 打开文件弹层，Enter 采纳插入 @路径 加尾空格", async () => {
    mockSuggestBridge();
    renderComposer({ workspaceRoot: "D:/repo" });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "看下 @main");
    await waitFor(() => screen.getByRole("listbox"));
    const options = screen.getAllByRole("option");
    expect(options[0]!.textContent).toContain("main.ts");
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toBe("看下 @src/app/main.ts ");
    // 采纳后 token 完形，弹层关闭。
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("输入 / 打开技能弹层，Enter 采纳插入 /技能名 调用形", async () => {
    mockSuggestBridge();
    renderComposer({ workspaceRoot: "D:/repo" });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "/deb");
    await waitFor(() => screen.getByRole("listbox"));
    expect(screen.getAllByRole("option")[0]!.textContent).toContain("/debugging");
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toBe("/debugging ");
  });

  it("↑↓ 移动活动行（aria-selected 跟随）", async () => {
    mockSuggestBridge();
    renderComposer({ workspaceRoot: "D:/repo" });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "@");
    await waitFor(() => screen.getAllByRole("option"));
    const [first, second] = screen.getAllByRole("option");
    expect(first!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    expect(first!.getAttribute("aria-selected")).toBe("false");
    expect(second!.getAttribute("aria-selected")).toBe("true");
  });

  it("Esc 关闭后同词保持关闭；重新输入新 @ 词可再开", async () => {
    mockSuggestBridge();
    renderComposer({ workspaceRoot: "D:/repo" });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "@ma");
    await waitFor(() => screen.getByRole("listbox"));
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    // 同 token 内继续输入：保持关闭。
    typeInto(ta, "@main");
    expect(screen.queryByRole("listbox")).toBeNull();
    // 清空后重新输入：重新打开。
    typeInto(ta, "");
    typeInto(ta, "@ut");
    await waitFor(() => screen.getByRole("listbox"));
    expect(screen.getAllByRole("option")[0]!.textContent).toContain("utils.ts");
  });

  it("无项目根：@ 弹层给未绑定提示且不拉文件清单", async () => {
    const bridge = mockSuggestBridge();
    renderComposer();
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "@x");
    await waitFor(() => screen.getByRole("listbox"));
    expect(screen.getByText("composer.suggest.noWorkspace")).toBeTruthy();
    expect(screen.queryByRole("option")).toBeNull();
    expect(bridge.listWorkspaceFiles).not.toHaveBeenCalled();
  });

  it("/ 越过空白（完形）后弹层收起，Enter 照常发送", async () => {
    const onSend = vi.fn();
    mockSuggestBridge();
    renderComposer({ onSend, workspaceRoot: "D:/repo" });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "/deb");
    await waitFor(() => screen.getByRole("listbox"));
    typeInto(ta, "/debugging 修一下");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/debugging 修一下", []);
  });

  it("Esc 关闭后「+」菜单 @ 项重开弹层（显式意图解除关闭）", async () => {
    mockSuggestBridge();
    renderComposer({ workspaceRoot: "D:/repo" });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "@ma");
    await waitFor(() => screen.getByRole("listbox"));
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    // 值已以 @ 开头：insertPrefix 不改值，但弹层必须因菜单点击重开。
    fireEvent.keyDown(screen.getByRole("button", { name: "composer.addContext" }), { key: "Enter" });
    const menu = await waitFor(() => screen.getByRole("menu"));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /chat.hint.at/ }));
    await waitFor(() => screen.getByRole("listbox"));
  });
});

// ---- 附件（选择 / 拖放 / 粘贴 → chip → 随消息发送） ---------------------------

const imagePart = {
  type: "attachment" as const,
  name: "shot.png",
  source: { key: `sha256:${"1".repeat(64)}`, mediaType: "image/png", byteLength: 10 },
  representations: [{ kind: "image" as const, content: { key: `sha256:${"2".repeat(64)}`, mediaType: "image/png", byteLength: 10 } }],
};

function mockAttachBridge() {
  return mockSuggestBridge({
    importAttachmentBytes: vi.fn(async (name: string) => ({
      part: { ...imagePart, name },
      preview: { kind: "image" as const, thumbnailKey: `sha256:${"5".repeat(64)}`, width: 24, height: 24 },
      warnings: [],
    })),
  });
}

function mockFile(name: string, bytes: number[] = [0x89, 0x50, 0x4e, 0x47]): File {
  return new File([new Uint8Array(bytes)], name, { type: "application/octet-stream" });
}

describe("Composer 附件", () => {

  it("文件选择导入出 chip，发送携带附件 part 并清空", async () => {
    const bridge = mockAttachBridge();
    const onSend = vi.fn();
    renderComposer({ onSend, workspaceRoot: "D:/repo", visionSupported: true });
    const input = screen.getByTestId("composer-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [mockFile("shot.png")] } });
    await waitFor(() => screen.getByText("shot.png"));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "看图");
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("看图", [imagePart]);
    expect(bridge.importAttachmentBytes).toHaveBeenCalled();
    expect(screen.queryByText("shot.png")).toBeNull();
  });

  it("拖放与粘贴导入（DataTransfer File）", async () => {
    mockAttachBridge();
    renderComposer({ workspaceRoot: "D:/repo" });
    const card = screen.getByTestId("chat-composer").firstElementChild as HTMLElement;
    fireEvent.drop(card, { dataTransfer: { files: [mockFile("dropped.png")], types: ["Files"] } });
    await waitFor(() => screen.getByText("dropped.png"));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.paste(ta, { clipboardData: { files: [mockFile("pasted.md", [0x68, 0x65])] } });
    await waitFor(() => screen.getByText("pasted.md"));
  });

  it("非视觉模型：图片附件禁发并提示，移除后可发（规格 §7 不丢附件）", async () => {
    mockAttachBridge();
    const onSend = vi.fn();
    renderComposer({ onSend, workspaceRoot: "D:/repo", visionSupported: false });
    const input = screen.getByTestId("composer-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [mockFile("shot.png")] } });
    await waitFor(() => screen.getByText("composer.attach.visionBlocked"));
    const send = screen.getByRole("button", { name: "chat.send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    // 输入文本后移除附件：门控解除、可发送。
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "改用文字描述");
    fireEvent.click(screen.getByRole("button", { name: "composer.attach.remove" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "chat.send" }) as HTMLButtonElement).disabled).toBe(false));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("附件-only 轮可发送（空文本）；移除钮清 chip", async () => {
    mockAttachBridge();
    const onSend = vi.fn();
    renderComposer({ onSend, workspaceRoot: "D:/repo", visionSupported: true });
    const input = screen.getByTestId("composer-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [mockFile("shot.png")] } });
    await waitFor(() => screen.getByText("shot.png"));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("", [imagePart]);
  });

  it("导入失败内联红字提示且不产 chip", async () => {
    mockSuggestBridge({
      importAttachmentBytes: vi.fn(async () => {
        throw new Error("附件 huge.bin 超过 25 MiB 上限");
      }),
    });
    renderComposer({ workspaceRoot: "D:/repo" });
    const input = screen.getByTestId("composer-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [mockFile("huge.bin")] } });
    await waitFor(() => screen.getByText(/25 MiB/));
    expect(screen.queryByRole("button", { name: "composer.attach.remove" })).toBeNull();
  });

  it("发送被拒（onSend 拒绝）：乐观清空后恢复文本与附件 chip（规格 §7）", async () => {
    mockAttachBridge();
    const onSend = vi.fn(async () => {
      throw new Error("gate");
    });
    renderComposer({ onSend, workspaceRoot: "D:/repo", visionSupported: true });
    const input = screen.getByTestId("composer-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [mockFile("shot.png")] } });
    await waitFor(() => screen.getByText("shot.png"));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "看图");
    fireEvent.keyDown(ta, { key: "Enter" });
    // 拒绝后：文本与 chip 恢复，等待用户处置。
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("看图"));
    expect(screen.getByText("shot.png")).toBeTruthy();
  });

  it("零表示 PDF（扫描件）预阻断：禁发并内联提示，移除后解除", async () => {
    mockSuggestBridge({
      importAttachmentBytes: vi.fn(async (name: string) => ({
        part: {
          type: "attachment" as const,
          name,
          source: { key: `sha256:${"6".repeat(64)}`, mediaType: "application/pdf", byteLength: 8 },
          representations: [],
        },
        preview: { kind: "binary" as const },
        warnings: ["扫描 PDF：无可抽取文本，未选择页面时无法提供内容"],
      })),
    });
    renderComposer({ workspaceRoot: "D:/repo", visionSupported: true });
    const input = screen.getByTestId("composer-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [mockFile("scan.pdf", [0x25, 0x50, 0x44, 0x46])] } });
    await waitFor(() => screen.getByText("composer.attach.scannedPdf"));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    typeInto(ta, "读这个");
    expect((screen.getByRole("button", { name: "chat.send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "composer.attach.remove" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "chat.send" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
