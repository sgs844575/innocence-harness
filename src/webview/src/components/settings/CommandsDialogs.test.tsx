// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommandImportDialog } from "./CommandsDialogs";
import type { CommandsApi } from "./CommandsPanel";
afterEach(cleanup);
it("clears selection on scope change and imports into the chosen project", async () => {
  const command = { name: "sample", description: "Example", sourceFile: "/source/sample.md", origin: "external-a", imported: false };
  const api = { commandSettingsDiscover: vi.fn(async () => [command]), commandSettingsImport: vi.fn(async () => {}) } as unknown as CommandsApi;
  render(<CommandImportDialog api={api} target={null} spaces={[{ root: "/project", name: "Project" }]} label={(key) => key} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /sample/ }));
  fireEvent.click(screen.getByRole("button", { name: "importScope" }));
  fireEvent.click(await screen.findByRole("button", { name: "Project" }));
  await waitFor(() => expect(api.commandSettingsDiscover).toHaveBeenLastCalledWith("/project"));
  expect(await screen.findByRole("checkbox", { name: /sample/ })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "import" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /sample/ }));
  fireEvent.click(screen.getByRole("button", { name: "import" }));
  await waitFor(() => expect(api.commandSettingsImport).toHaveBeenCalledWith("/project", "/source/sample.md"));
});
