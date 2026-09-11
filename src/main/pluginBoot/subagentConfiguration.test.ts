import { expect, it, vi } from "vitest";
import path from "node:path";
import { configuredSubagentPlugin } from "./subagentConfiguration";

it("injects current user storage and excludes project configuration for projectless sessions", async () => {
  let user = "first";
  const apply = vi.fn();
  const createScoped = vi.fn(async () => ({ apply }));
  const plugin = configuredSubagentPlugin(async () => ({ createScoped }), () => user, "");
  user = "current";
  await plugin.apply({} as never);
  expect(createScoped).toHaveBeenCalledWith("current", undefined);
  expect(apply).toHaveBeenCalledTimes(1);
  await configuredSubagentPlugin(async () => ({ createScoped }), () => user, "/project").apply({} as never);
  expect(createScoped).toHaveBeenLastCalledWith("current", path.join("/project", ".innocence"));
});
