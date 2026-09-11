import type { RepositorySource } from "@innocenceharness/harness-plugin-catalog";

// Public catalog endpoints explicitly selected for the host's default sources.
export const defaultPluginMarkets: readonly { title: string; source: RepositorySource }[] = [
  { title: "Claude Code", source: { url: "https://github.com/anthropics/claude-plugins-official.git" } },
  { title: "Codex", source: { url: "https://github.com/openai/plugins.git" } },
];
