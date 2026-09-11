import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { createSubagentSettingsService } from "./subagentSettingsService";

describe("subagent settings host targets", () => {
  it("resolves the data root lazily and only accepts known projects", async () => {
    let user = path.resolve("user-one"); const project = path.resolve("project-one");
    const list = vi.fn(async () => []), save = vi.fn(), remove = vi.fn();
    const service = createSubagentSettingsService({ getDataRoot: () => user, getWorkspaceRoots: () => [project, project, ""], loadCatalog: async () => ({ list, save, remove }) });
    await service.subagentCatalog(null);
    expect(list).toHaveBeenLastCalledWith(user, undefined);
    user = path.resolve("user-two");
    await service.subagentCatalog(project);
    expect(list).toHaveBeenLastCalledWith(user, path.join(project, ".innocence"));
    expect(await service.subagentWorkspaces()).toHaveLength(1);
    await expect(service.subagentCatalog(path.resolve("unknown"))).rejects.toThrow("Unknown");
    await expect(service.subagentRemove("../outside", "test")).rejects.toThrow("Unknown");
    expect(remove).not.toHaveBeenCalled();
  });
});
