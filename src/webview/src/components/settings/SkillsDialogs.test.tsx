// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkillImportDialog } from "./SkillsDialogs";
import type { SkillsApi } from "./SkillsPanel";
afterEach(cleanup);
it("clears selection on scope change and imports into the chosen project", async () => {
  const skill = { name: "sample", description: "Example", sourceDir: "/source/sample", origin: "external", imported: false };
  const api = { skillSettingsDiscover: vi.fn(async () => [skill]), skillSettingsImport: vi.fn(async () => {}) } as unknown as SkillsApi;
  render(<SkillImportDialog api={api} target={null} spaces={[{ root: "/project", name: "Project" }]} label={(key) => key} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /sample/ }));
  fireEvent.click(screen.getByRole("button", { name: "importScope" }));
  fireEvent.click(await screen.findByRole("button", { name: "Project" }));
  await waitFor(() => expect(api.skillSettingsDiscover).toHaveBeenLastCalledWith("/project"));
  expect(await screen.findByRole("checkbox", { name: /sample/ })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "import" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /sample/ }));
  fireEvent.click(screen.getByRole("button", { name: "import" }));
  await waitFor(() => expect(api.skillSettingsImport).toHaveBeenCalledWith("/project", "/source/sample"));
});
