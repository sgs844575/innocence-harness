import { describe, expect, it, vi } from "vitest";
import type { HarnessSettings } from "../../../shared/ipc";
import { createSettingsCommitter } from "./settingsCommitter";

const saved: HarnessSettings = {
  profiles: [], activeProfileId: "__mock__", activeModel: "mock", workspaceRoot: "D:/saved", permissionMode: "ask",
};

describe("settings committer", () => {
  it("does not apply optimistic renderer state or refresh dependents when persistence rejects", async () => {
    const apply = vi.fn();
    const refresh = vi.fn();
    const onError = vi.fn();
    const commit = createSettingsCommitter({
      save: vi.fn().mockRejectedValue(new Error("disk write failed")),
      apply,
      refresh,
      onError,
    });

    await expect(commit({ themeMode: "dark" })).rejects.toThrow("disk write failed");
    expect(apply).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("applies the host projection only after persistence succeeds", async () => {
    const apply = vi.fn();
    const refresh = vi.fn();
    const commit = createSettingsCommitter({
      save: vi.fn().mockResolvedValue(saved),
      apply,
      refresh,
      onError: vi.fn(),
    });

    await commit({ workspaceRoot: "D:/saved" });
    expect(apply).toHaveBeenCalledWith(saved);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
