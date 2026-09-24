// Session-capability prefix renderer: section coverage (plugins / skills /
// MCP / hooks), omission of empty sections, the fully-empty short circuit,
// and the fragment identity shared-bucket placement.
import { describe, expect, it } from "vitest";
import {
  capabilityPrefixFragment,
  renderCapabilityPrefix,
} from "../src/capability-prefix";

describe("renderCapabilityPrefix", () => {
  it("renders every populated section", () => {
    const text = renderCapabilityPrefix({
      plugins: ["skills", "team-x (ecosystem)"],
      skillDirs: ["D:/ws/.innocence/skills", "D:/ws/.innocence/commands"],
      mcpServers: ["docs", "search (from plugin team-x)"],
      hooks: [
        { event: "sessionStart", commands: 1 },
        { event: "preToolCall", commands: 2 },
      ],
    });
    expect(text).toContain("# Session capabilities");
    expect(text).toContain("- skills");
    expect(text).toContain("- team-x (ecosystem)");
    expect(text).toContain("Slash commands and skills load from: D:/ws/.innocence/skills, D:/ws/.innocence/commands");
    expect(text).toContain("skill index follows at the end of this prompt");
    expect(text).toContain("mcp__<server>__<tool>");
    expect(text).toContain("- docs");
    expect(text).toContain("- search (from plugin team-x)");
    expect(text).toContain("- sessionStart: 1 command — first run asks for permission");
    expect(text).toContain("- preToolCall: 2 commands — first run asks for permission");
    // Section order: plugins → skills → servers → hooks.
    expect(text.indexOf("## Plugins")).toBeLessThan(text.indexOf("## Skills and commands"));
    expect(text.indexOf("## Skills and commands")).toBeLessThan(text.indexOf("## MCP servers"));
    expect(text.indexOf("## MCP servers")).toBeLessThan(text.indexOf("## Hooks"));
  });

  it("omits empty sections and keeps the populated ones", () => {
    const text = renderCapabilityPrefix({ mcpServers: ["docs"] });
    expect(text).toContain("## MCP servers");
    expect(text).not.toContain("## Plugins");
    expect(text).not.toContain("## Skills and commands");
    expect(text).not.toContain("## Hooks");
  });

  it("renders an empty string when no section has content", () => {
    expect(renderCapabilityPrefix({})).toBe("");
    expect(renderCapabilityPrefix({ plugins: [], skillDirs: [], mcpServers: [], hooks: [] })).toBe("");
  });
});

describe("capabilityPrefixFragment", () => {
  it("carries the shared-bucket identity with an early order", () => {
    const fragment = capabilityPrefixFragment({ plugins: ["skills"] });
    expect(fragment.id).toBe("shared.capabilities");
    expect(fragment.order).toBe(120);
    expect(fragment.modes).toBeUndefined();
    expect(fragment.when).toBeUndefined();
    expect(fragment.render({ activeMode: "plan", traits: {} })).toContain("## Plugins");
  });
});
