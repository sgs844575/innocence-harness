// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  setProviderApiKey: vi.fn(),
  setHarnessSettings: vi.fn(),
  listProviderModels: vi.fn(),
  enrichModels: vi.fn(),
}));
vi.mock("../../../lib/ipc", () => ({ api: apiMocks }));

import { ProviderSettingsPage } from "./ProviderSettingsPage";
import type { HarnessSettings } from "../../../../../shared/ipc";

afterEach(cleanup);

const settings: HarnessSettings = {
  profiles: [{
    id: "p1", name: "Configured", kind: "google", apiKey: "", apiKeyConfigured: true,
    baseURL: "", enabled: true, models: [{ id: "gemini-2.5-pro", source: "preset" }],
  }],
  activeProfileId: "p1", activeModel: "gemini-2.5-pro", workspaceRoot: "", permissionMode: "ask",
};

describe("ProviderSettingsPage credentials", () => {
  it("adds a native provider before saving its transient key through the one-way host API", async () => {
    const onSettingsChange = vi.fn();
    const saved = {
      ...settings,
      profiles: [...settings.profiles, {
        id: expect.any(String), name: "Native generative", kind: "google" as const, apiKey: "", apiKeyConfigured: false,
        baseURL: "", enabled: true, models: [{ id: "gemini-2.5-pro", source: "preset" as const }], preset: false,
      }],
    };
    apiMocks.enrichModels.mockResolvedValue([{ id: "gemini-2.5-pro", source: "preset" }]);
    apiMocks.setHarnessSettings.mockResolvedValue(saved);
    apiMocks.setProviderApiKey.mockResolvedValue(saved);
    render(<ProviderSettingsPage settings={settings} onSettingsChange={onSettingsChange} />);

    fireEvent.click(screen.getByRole("button", { name: /添加厂家/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Native generative$/ }));
    fireEvent.change(screen.getByLabelText("API 密钥（可选）"), { target: { value: "new-key" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(apiMocks.setHarnessSettings).toHaveBeenCalled());
    const persisted = apiMocks.setHarnessSettings.mock.calls[0]?.[0] as HarnessSettings;
    const added = persisted.profiles.at(-1)!;
    expect(added).toMatchObject({ kind: "google", apiKey: "" });
    await waitFor(() => expect(apiMocks.setProviderApiKey).toHaveBeenCalledWith(added.id, "new-key"));
  });
});
