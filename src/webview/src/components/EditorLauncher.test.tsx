// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorCatalog, EditorIpcApi } from "../../../shared/editorIpc";
import { zhCN } from "../lib/i18n";
import { EditorLauncher, WorkspaceEditorLauncher } from "./EditorLauncher";

afterEach(cleanup);
const t = (key: string) => zhCN[key] ?? key;
function fixture() {
  let catalog: EditorCatalog = { selectedId: "one", editors: [
    { id: "file-manager", name: "", kind: "fileManager" },
    { id: "one", name: "Editor One", kind: "editor" },
    { id: "two", name: "Editor Two", kind: "editor", icon: "data:image/png;base64,aWNvbg==" },
  ] };
  const api: EditorIpcApi = {
    editorsList: vi.fn(async () => catalog),
    editorsSelect: vi.fn(async (id) => { catalog = { ...catalog, selectedId: id }; return catalog; }),
    editorOpenWorkspace: vi.fn(async () => {}),
  };
  return api;
}

describe("editor launch controls", () => {
  it("shares selection between project and file controls, and selecting never launches", async () => {
    const api = fixture();
    const openFile = vi.fn(async () => {});
    render(<><WorkspaceEditorLauncher api={api} t={t} target={{ sessionId: "active" }} onError={vi.fn()} /><EditorLauncher api={api} t={t} openLabel="Open memory" selectLabel="Memory editor" onOpen={openFile} onError={vi.fn()} /></>);
    await waitFor(() => expect(screen.getByRole("button", { name: "在外部编辑器打开" })).toBeEnabled());
    expect(api.editorsList).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "选择编辑器" }));
    expect(await screen.findByRole("button", { name: "Editor One" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Editor Two" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open memory" })).toHaveAttribute("title", "Open memory · Editor Two"));
    expect(api.editorsSelect).toHaveBeenCalledWith("two");
    expect(api.editorOpenWorkspace).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Editor Two" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "在外部编辑器打开" }));
    await waitFor(() => expect(api.editorOpenWorkspace).toHaveBeenCalledWith({ sessionId: "active" }));
    fireEvent.click(screen.getByRole("button", { name: "Open memory" }));
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("updates the active project target and disables opening for a projectless conversation", async () => {
    const api = fixture();
    const onError = vi.fn();
    const { rerender } = render(<WorkspaceEditorLauncher api={api} t={t} target={{ sessionId: "first" }} onError={onError} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "在外部编辑器打开" })).toBeEnabled());
    rerender(<WorkspaceEditorLauncher api={api} t={t} target={{ sessionId: "second" }} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "在外部编辑器打开" }));
    expect(api.editorOpenWorkspace).toHaveBeenCalledWith({ sessionId: "second" });
    rerender(<WorkspaceEditorLauncher api={api} t={t} onError={onError} />);
    expect(screen.getByRole("button", { name: "在外部编辑器打开" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "在外部编辑器打开" })).toHaveAttribute("aria-description", "当前会话未绑定项目");
  });

  it("dismisses the selector on Escape and reports a failed selection", async () => {
    const api = fixture();
    const onError = vi.fn();
    vi.mocked(api.editorsSelect).mockRejectedValue(new Error("Cannot save selection"));
    render(<WorkspaceEditorLauncher api={api} t={t} target={{ workspaceRoot: "/project" }} onError={onError} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "在外部编辑器打开" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选择编辑器" }));
    await screen.findByRole("button", { name: "Editor One" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Editor One" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Editor One" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "选择编辑器" }));
    fireEvent.click(await screen.findByRole("button", { name: "Editor Two" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Cannot save selection" })));
    expect(screen.getByRole("button", { name: "在外部编辑器打开" })).toHaveAttribute("title", "在外部编辑器打开 · Editor One");
  });
});
