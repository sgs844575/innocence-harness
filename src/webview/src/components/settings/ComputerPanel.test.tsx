// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@innocenceharness/harness-electron";
import { ComputerPanel } from "./ComputerPanel";

afterEach(cleanup);
const t = (key: string) => key;

describe("ComputerPanel", () => {
  it("persists each switch independently and locks while saving", async () => {
    let finish!: () => void;
    const onPatchSettings = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<ComputerPanel t={t} settings={DEFAULT_SETTINGS} onPatchSettings={onPatchSettings} />);
    const master = screen.getByRole("switch", { name: "settings.computer.enabled" });
    const shortcut = screen.getByRole("switch", { name: "settings.computer.showButton" });
    expect(master).toHaveAttribute("aria-checked", "true");
    expect(shortcut).toHaveAttribute("aria-checked", "false");
    fireEvent.click(master);
    expect(onPatchSettings).toHaveBeenCalledWith({ computerEnabled: false });
    expect(shortcut).toBeDisabled();
    finish();
    await waitFor(() => expect(shortcut).toBeEnabled());
    fireEvent.click(shortcut);
    expect(onPatchSettings).toHaveBeenLastCalledWith({ showComputerButton: true });
    finish();
    await waitFor(() => expect(shortcut).toBeEnabled());
  });

  it("retains saved values and exposes errors when persistence fails", async () => {
    render(<ComputerPanel t={t} settings={{ ...DEFAULT_SETTINGS, showComputerButton: true }}
      onPatchSettings={async () => { throw new Error("Storage unavailable"); }} />);
    const master = screen.getByRole("switch", { name: "settings.computer.enabled" });
    fireEvent.click(master);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
    expect(master).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "settings.computer.showButton" })).toHaveAttribute("aria-checked", "true");
  });

  it("disables both switches until settings have loaded", () => {
    render(<ComputerPanel t={t} settings={null} onPatchSettings={() => {}} />);
    for (const toggle of screen.getAllByRole("switch")) expect(toggle).toBeDisabled();
  });
});
