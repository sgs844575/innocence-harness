import { expect, it, vi } from "vitest";
import plugin, { skillCreationFragment } from "../src";
it("registers the matching agent and a mode-scoped skill creation workflow", () => {
  const register = vi.fn(); const registerFragment = vi.fn();
  plugin.apply({ agents: { register }, systemPrompt: { registerFragment } } as never);
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: "skills-creator" }));
  expect(registerFragment).toHaveBeenCalledWith(skillCreationFragment);
  expect(skillCreationFragment.modes).toEqual(["skills-creator"]);
  const prompt = skillCreationFragment.render({ activeMode: "skills-creator", traits: {} });
  expect(prompt).toContain("SKILL.md");
  expect(prompt).toContain("English");
  expect(prompt).toContain("Perform the work in this conversation");
});
