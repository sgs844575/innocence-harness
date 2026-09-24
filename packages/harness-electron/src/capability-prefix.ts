// Session-capability prefix fragment: one early, mode-independent section of
// the assembled system prompt telling the model which capability surfaces are
// active — installed plugins, where skills and slash commands load from, the
// MCP servers in play, and the declared hook events. The composition root
// collects the facts while it resolves the session's plugin set (same pass
// that resolves entries, ecosystem directories and hook declarations), then
// mounts the fragment through a tiny plugin; the renderer here is pure so the
// wording stays testable without a kernel. All text is English (repo rule for
// LLM-facing content). Empty sections are omitted; a fully empty summary
// renders "" so the assembler drops the fragment outright.
import type { PromptFragment } from "@innocenceharness/harness-system-prompt";

/** One hook event's declaration count (native vocabulary, post-mapping). */
export interface CapabilityHookSummary {
  readonly event: string;
  readonly commands: number;
}

/** Facts the capability prefix states; every member optional-by-emptiness. */
export interface CapabilityPrefixData {
  /** Active plugin entries for this session (ids; ecosystem entries marked). */
  readonly plugins?: readonly string[];
  /** Skill/command directories the skills plugin loads from. */
  readonly skillDirs?: readonly string[];
  /** MCP server names in play (ecosystem ones annotated with their plugin). */
  readonly mcpServers?: readonly string[];
  /** Declared hook events with command counts (top-level + ecosystem). */
  readonly hooks?: readonly CapabilityHookSummary[];
}

/** Renders the capability prefix; "" when no section has content. */
export function renderCapabilityPrefix(data: CapabilityPrefixData): string {
  const lines: string[] = [
    "# Session capabilities",
    "",
    "Capabilities active in this session. Prefer them over rebuilding what they already provide, and never simulate one that is absent.",
  ];
  if (data.plugins && data.plugins.length > 0) {
    lines.push("", "## Plugins", ...data.plugins.map((name) => `- ${name}`));
  }
  if (data.skillDirs && data.skillDirs.length > 0) {
    lines.push(
      "",
      "## Skills and commands",
      `- Slash commands and skills load from: ${data.skillDirs.join(", ")}`,
      "- The full skill index follows at the end of this prompt; invoke one with /name instead of improvising an equivalent.",
    );
  }
  if (data.mcpServers && data.mcpServers.length > 0) {
    lines.push(
      "",
      "## MCP servers",
      "Tools surface under mcp__<server>__<tool> names:",
      ...data.mcpServers.map((name) => `- ${name}`),
    );
  }
  if (data.hooks && data.hooks.length > 0) {
    lines.push(
      "",
      "## Hooks",
      ...data.hooks.map(
        (hook) =>
          `- ${hook.event}: ${hook.commands} command${hook.commands === 1 ? "" : "s"} — first run asks for permission; output arrives as system-reminder context.`,
      ),
    );
  }
  const stated =
    (data.plugins?.length ?? 0) > 0 ||
    (data.skillDirs?.length ?? 0) > 0 ||
    (data.mcpServers?.length ?? 0) > 0 ||
    (data.hooks?.length ?? 0) > 0;
  return stated ? lines.join("\n") : "";
}

/**
 * The fragment mounted by the composition root. Shared bucket (no modes, no
 * when) with a low order so the inventory sits right after the base identity
 * and before the mode personas.
 */
export function capabilityPrefixFragment(data: CapabilityPrefixData): PromptFragment {
  return {
    id: "shared.capabilities",
    order: 120,
    render: () => renderCapabilityPrefix(data),
  };
}
