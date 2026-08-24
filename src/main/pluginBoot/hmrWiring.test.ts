import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clientPluginWatchTargets, watchClientPluginTargets } from "./compose";
import type { HostHmrWatcher } from "./hmrWatcher";

function fakeWatcher() {
  const registrations: Array<{ id: string; callback: () => Promise<void> }> = [];
  let disposed = false;
  const watcher: HostHmrWatcher = {
    async watchPath(id, _file, callback) {
      registrations.push({ id, callback });
      return async () => {};
    },
    async dispose() {
      disposed = true;
    },
  };
  return { watcher, registrations, wasDisposed: () => disposed };
}

describe("plugin boot HMR wiring", () => {
  it("derives client entry watch targets from the dual plugin roots", () => {
    expect(clientPluginWatchTargets(
      [
        { id: "example", client: true },
        { id: "tools", client: false },
      ],
      "C:/test/user-plugins",
      "C:/test/builtin-plugins",
    )).toEqual([
      {
        id: "example",
        userPath: path.join("C:/test/user-plugins", "example", "dist", "client.js"),
        builtinPath: path.join("C:/test/builtin-plugins", "example", "dist", "client.js"),
      },
    ]);
  });

  it("registers existing user and builtin client targets and isolates refresh failures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ic-hmr-wiring-"));
    try {
      const userPath = path.join(root, "user", "client", "dist");
      const builtinPath = path.join(root, "builtin", "client", "dist");
      await fs.mkdir(userPath, { recursive: true });
      await fs.mkdir(builtinPath, { recursive: true });
      await fs.writeFile(path.join(userPath, "client.js"), "user", "utf8");
      await fs.writeFile(path.join(builtinPath, "client.js"), "builtin", "utf8");
      const fake = fakeWatcher();
      const logs: string[] = [];
      const changes: string[] = [];
      await watchClientPluginTargets(
        [{ id: "client", client: true }],
        path.join(root, "user"),
        path.join(root, "builtin"),
        fake.watcher,
        async (id) => {
          changes.push(id);
          throw new Error("refresh failed");
        },
        (level, message) => logs.push(`${level}:${message}`),
      );
      expect(fake.registrations.map(({ id }) => id).sort()).toEqual(["client:builtin", "client:user"]);
      await Promise.all(fake.registrations.map(({ callback }) => callback()));
      expect(changes).toEqual(["client", "client"]);
      expect(logs).toHaveLength(2);
      await fake.watcher.dispose();
      expect(fake.wasDisposed()).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
