import { expect, it, vi } from "vitest";
import { startSkillCreation } from "./skillCreation";
it("opens an empty chat in the selected scope after selecting the creator mode", async () => {
  const calls: string[] = [];
  const selectMode = vi.fn(async () => { calls.push("mode"); });
  const openChat = vi.fn(() => { calls.push("chat"); });
  await startSkillCreation("/project", { selectMode, openChat });
  expect(calls).toEqual(["mode", "chat"]);
  expect(openChat).toHaveBeenCalledWith("/project");
  await startSkillCreation(null, { selectMode, openChat });
  expect(openChat).toHaveBeenLastCalledWith(null);
});
it("preserves the current page if selecting the mode fails", async () => {
  const openChat = vi.fn();
  await expect(startSkillCreation(null, { selectMode: async () => { throw new Error("Save failed"); }, openChat })).rejects.toThrow("Save failed");
  expect(openChat).not.toHaveBeenCalled();
});
