// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@innocenceharness/harness-electron";
import type { MemoryFileInfo, MemoryIpcApi } from "../../../../shared/memoryIpc";
import { zhCN } from "../../lib/i18n";
import { MemoryPanel } from "./MemoryPanel";

afterEach(cleanup);
const t = (key: string) => zhCN[key] ?? key;
const file = (name: string): MemoryFileInfo => ({ name, path: `/project/.innocence/memory/${name}`, size: 25, updatedAt: Date.UTC(2026, 8, 6, 12) });
function api(): MemoryIpcApi {
  return {
    memoryWorkspaces: vi.fn(async () => [{ name: "Project A", root: "/a" }, { name: "Project B", root: "/b" }]),
    memoryFiles: vi.fn(async () => [file("MEMORY.md"), file("build-rules.md")]),
    memoryReadFile: vi.fn(async (_target, name) => ({ ...file(name), content: "# Lasting decisions\nRun checks before completion." })),
    memoryOpenFile: vi.fn(async () => {}),
  };
}

describe("MemoryPanel", () => {
  it("shows persisted files, filters without requests, refreshes and previews", async () => {
    const port = api();
    render(<MemoryPanel t={t} settings={DEFAULT_SETTINGS} api={port} initialWorkspace="/a" onPatchSettings={() => {}} />);
    expect(await screen.findByText("build-rules.md")).toBeTruthy();
    expect(screen.getByText("2 条记忆")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "BUILD" } });
    expect(screen.queryByText("MEMORY.md")).toBeNull();
    expect(port.memoryFiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "预览 build-rules.md" }));
    expect(await screen.findByText(/Run checks before completion/)).toBeTruthy();
    expect(port.memoryReadFile).toHaveBeenCalledWith("/a", "build-rules.md");
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新记忆文件" }));
    await waitFor(() => expect(port.memoryFiles).toHaveBeenCalledTimes(2));
  });

  it("keeps the selected workspace when an older response arrives late", async () => {
    const port = api();
    let finish!: (files: MemoryFileInfo[]) => void;
    vi.mocked(port.memoryFiles).mockImplementation((target) => target === "/b" ? Promise.resolve([file("b.md")]) : Promise.resolve([file("a.md")]));
    render(<MemoryPanel t={t} settings={DEFAULT_SETTINGS} api={port} initialWorkspace="/a" onPatchSettings={() => {}} />);
    await screen.findByText("a.md");
    vi.mocked(port.memoryFiles).mockImplementation((target) => target === "/b" ? Promise.resolve([file("b.md")]) : new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "刷新记忆文件" }));
    fireEvent.click(screen.getByRole("button", { name: "工作区" }));
    fireEvent.click(screen.getByRole("button", { name: "Project B" }));
    await screen.findByText("b.md");
    await act(async () => finish([file("stale.md")]));
    expect(screen.queryByText("stale.md")).toBeNull();
    expect(screen.getByText("b.md")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Project A" })).toBeNull();
  });

  it("saves only the memory plugin toggle and exposes failure without changing the saved state", async () => {
    const port = api();
    let fail!: (error: Error) => void;
    const patch = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    render(<MemoryPanel t={t} settings={DEFAULT_SETTINGS} api={port} onPatchSettings={patch} />);
    await screen.findByText("MEMORY.md");
    const toggle = screen.getByRole("switch", { name: "工作区记忆" });
    fireEvent.click(toggle);
    expect(patch).toHaveBeenCalledWith({ pluginToggleChanges: { memory: false } });
    expect(toggle).toBeDisabled();
    await act(async () => fail(new Error("Storage unavailable")));
    expect(screen.getByRole("alert")).toHaveTextContent("Storage unavailable");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeEnabled();
  });

  it("opens the correct file, shows action errors, and keeps files visible while disabled", async () => {
    const port = api();
    vi.mocked(port.memoryOpenFile).mockRejectedValueOnce(new Error("Editor unavailable"));
    render(<MemoryPanel t={t} settings={{ ...DEFAULT_SETTINGS, pluginToggles: { memory: false } }} api={port} initialWorkspace="/b" onPatchSettings={() => {}} />);
    await screen.findByText("MEMORY.md");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "在编辑器中打开 MEMORY.md" }));
    expect(port.memoryOpenFile).toHaveBeenCalledWith("/b", "MEMORY.md", "editor");
    expect(await screen.findByRole("alert")).toHaveTextContent("Editor unavailable");
    fireEvent.click(screen.getByRole("button", { name: "文件操作 MEMORY.md" }));
    fireEvent.click(screen.getByRole("button", { name: "在文件管理器中显示" }));
    await waitFor(() => expect(port.memoryOpenFile).toHaveBeenLastCalledWith("/b", "MEMORY.md", "reveal"));
  });

  it("shows load failures and allows retry without pretending the store is empty", async () => {
    const port = api();
    vi.mocked(port.memoryFiles).mockRejectedValueOnce(new Error("Access denied")).mockResolvedValueOnce([]);
    render(<MemoryPanel t={t} settings={DEFAULT_SETTINGS} api={port} onPatchSettings={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
    expect(screen.queryByText("暂无记忆文件")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新记忆文件" }));
    expect(await screen.findByText("暂无记忆文件")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "文件" })).queryAllByRole("listitem")).toHaveLength(0);
  });
});
