// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubagentsPanel } from "./SubagentsPanel";
import { zhCN } from "../../lib/i18n";
import type { CatalogPreset, SubagentSettingsApi } from "../../../../shared/subagentIpc";
afterEach(cleanup);
const t = (key: string) => zhCN[key] ?? key;
const preset: CatalogPreset = { id: "review", title: "Reviewer", description: "Review changes", systemPrompt: "Review changes carefully.", tools: "readOnly", enabled: true, source: "global" };
const api = (): SubagentSettingsApi => ({ subagentWorkspaces: vi.fn(async () => [{ root: "/project", name: "Project" }]), subagentCatalog: vi.fn(async () => [preset, { ...preset, id: "general", title: "Generalist", source: "system" as const }]), subagentSave: vi.fn(async () => {}), subagentRemove: vi.fn(async () => {}) });

describe("subagent settings", () => {
  it("edits user presets, preserves identifiers and shows save errors without discarding the draft", async () => {
    const bridge = api(); vi.mocked(bridge.subagentSave).mockRejectedValueOnce(new Error("Write failed"));
    render(<SubagentsPanel api={bridge} t={t} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Reviewer/ }));
    expect(screen.getByLabelText("标识符")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Write failed");
    expect(screen.getByLabelText("名称")).toHaveValue("Updated");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bridge.subagentSave).toHaveBeenLastCalledWith(null, expect.objectContaining({ id: "review", title: "Updated" }), false);
  });
  it("keeps built-ins read-only and creates a preset in the selected project", async () => {
    const bridge = api(); render(<SubagentsPanel api={bridge} t={t} />);
    fireEvent.click(await screen.findByRole("button", { name: /Generalist/ }));
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "生效范围" }));
    fireEvent.click(await screen.findByRole("button", { name: "Project" }));
    await waitFor(() => expect(bridge.subagentCatalog).toHaveBeenLastCalledWith("/project"));
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getByLabelText("标识符"), { target: { value: "audit" } });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Audit" } });
    fireEvent.change(screen.getByLabelText("说明"), { target: { value: "Audit files" } });
    fireEvent.change(screen.getByLabelText("系统提示词（英文）"), { target: { value: "Audit files carefully." } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(bridge.subagentSave).toHaveBeenCalledWith("/project", expect.objectContaining({ id: "audit" }), true));
  });
});
