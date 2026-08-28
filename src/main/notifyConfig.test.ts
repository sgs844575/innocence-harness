import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadNotifyChannelConfig } from "./notifyConfig";

describe("loadNotifyChannelConfig", () => {
  it("returns undefined when the config file is missing", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "notify-missing-"));
    await expect(loadNotifyChannelConfig(home)).resolves.toBeUndefined();
  });

  it("reads a complete notify block and normalizes optional fields", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "notify-full-"));
    await mkdir(path.join(home, ".innocence"), { recursive: true });
    await writeFile(
      path.join(home, ".innocence", "cordis.yml"),
      ["plugins:", "  fs: true", "notify:", "  appId: cli_app", "  appSecret: sec", "  receiveId: oc_chat", '  receiveIdType: "open_id"', "  domain: https://example.invalid"].join("\n"),
      "utf8",
    );
    await expect(loadNotifyChannelConfig(home)).resolves.toEqual({
      appId: "cli_app",
      appSecret: "sec",
      receiveId: "oc_chat",
      receiveIdType: "open_id",
      domain: "https://example.invalid",
    });
  });

  it("disables the channel on incomplete blocks, bad yaml and non-mapping blocks", async () => {
    const log = vi.fn();
    const home = await mkdtemp(path.join(os.tmpdir(), "notify-bad-"));
    await mkdir(path.join(home, ".innocence"), { recursive: true });
    const file = path.join(home, ".innocence", "cordis.yml");

    await writeFile(file, ["notify:", "  appId: cli_app"].join("\n"), "utf8");
    await expect(loadNotifyChannelConfig(home, log)).resolves.toBeUndefined();

    await writeFile(file, "notify: [oops", "utf8");
    await expect(loadNotifyChannelConfig(home, log)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("failed to parse"));

    await writeFile(file, "notify: just-a-string", "utf8");
    await expect(loadNotifyChannelConfig(home, log)).resolves.toBeUndefined();

    await writeFile(file, "other: 1", "utf8");
    await expect(loadNotifyChannelConfig(home)).resolves.toBeUndefined();
  });
});
