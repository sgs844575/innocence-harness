// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalSearchDialog } from "./GlobalSearchDialog";

afterEach(cleanup);

describe("GlobalSearchDialog", () => {
  it("forwards the selected relative file path to the workspace selection command", () => {
    const onSelectFile = vi.fn();
    render(
      <GlobalSearchDialog
        open
        onOpenChange={() => {}}
        sessions={[]}
        files={["src/renderer/App.tsx"]}
        actions={[]}
        onSelectSession={() => {}}
        onSelectFile={onSelectFile}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "src/renderer/App.tsx" }));
    expect(onSelectFile).toHaveBeenCalledWith("src/renderer/App.tsx");
  });

  it("filters typed task, operation, and file sources without using sidebar-local filtering", () => {
    render(
      <GlobalSearchDialog
        open
        onOpenChange={() => {}}
        sessions={[{ id: "s1", title: "Fix renderer" }, { id: "s2", title: "Update docs" }]}
        files={["src/renderer/App.tsx", "packages/core/index.ts"]}
        actions={[{ id: "review", label: "打开审查", onSelect: vi.fn() }]}
        onSelectSession={vi.fn()}
        onSelectFile={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "搜索任务、操作或文件" }), { target: { value: "renderer" } });
    expect(screen.getByRole("button", { name: "Fix renderer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update docs" })).toBeNull();
    expect(screen.getByRole("button", { name: "src/renderer/App.tsx" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开审查" })).toBeNull();
  });
});
