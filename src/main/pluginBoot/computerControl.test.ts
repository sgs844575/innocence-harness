import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@innocenceharness/harness-electron";
import { computerAccessFor, configureComputerEntry, configuredComputerPlugin } from "./computerControl";
import { Context } from "@innocenceharness/kernel";

describe("computer access composition", () => {
  it("binds the activity observer to the dynamically imported plugin and retains cleanup", async () => {
    const cleanup = vi.fn();
    const apply = vi.fn(() => cleanup);
    const isEnabled = () => true;
    const activity = { begin: vi.fn(() => vi.fn()) };
    const plugin = configuredComputerPlugin(async () => ({ apply }), isEnabled, activity);
    const ctx = new Context();
    expect(await plugin.apply(ctx)).toBe(cleanup);
    expect(apply).toHaveBeenCalledExactlyOnceWith(ctx, { isEnabled, activity });
    await ctx.fiber.dispose();
  });

  it("keeps the composer preference independent and reads live revocation", () => {
    let enabled = true;
    const access = computerAccessFor({ ...DEFAULT_SETTINGS, showComputerButton: false }, () => enabled);
    expect(access()).toBe(true);
    enabled = false;
    expect(access()).toBe(false);
    expect(computerAccessFor({ ...DEFAULT_SETTINGS, computerEnabled: false }, () => true)()).toBe(false);
  });
  it("applies the master switch after project choices and covers aliases", () => {
    for (const entry of [{ id: "computer", name: "computer", disabled: false }, { id: "alias", name: "kernel:computer" }]) {
      expect(configureComputerEntry(entry, () => false).disabled).toBe(true);
    }
    const unrelated = { id: "mcp", name: "mcp" };
    expect(configureComputerEntry(unrelated, () => false)).toBe(unrelated);
  });
});
