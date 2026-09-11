import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { record, safePath } from "./files";
import { componentFiles } from "./metadata";
import type { BundleIssue } from "./bundleServers";

export interface BundleAgent {
  id: string; title: string; description: string; systemPrompt: string;
  tools: "all" | string[];
  disallowedTools?: string[];
}
function toolNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const names = typeof value === "string" ? value.split(",").map((name) => name.trim()).filter(Boolean) : value;
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error("Only explicit tool names are supported.");
  return [...new Set(names as string[])];
}
export async function readBundleAgents(root: string, manifest?: Record<string, unknown>) {
  const agents: BundleAgent[] = [];
  const issues: BundleIssue[] = [];
  for (const file of await componentFiles(root, "agents", manifest)) {
    try {
      const raw = await readFile(await safePath(root, file), "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
      if (!front) throw new Error("Agent frontmatter is missing or malformed.");
      const fields = record(parse(front[1], { maxAliasCount: 50 }));
      const id = fields.name ?? path.basename(file, ".md");
      if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error("Invalid agent identifier.");
      if (typeof fields.description !== "string" || !fields.description.trim() || !front[2].trim()) throw new Error("An agent requires a description and prompt.");
      const extra = Object.keys(fields).filter((key) => !["name", "description", "tools", "disallowedTools", "model", "color"].includes(key));
      if (extra.length) throw new Error(`Unsupported agent options: ${extra.join(", ")}`);
      if (fields.model !== undefined && fields.model !== "inherit") throw new Error("Agent-specific model selection is not supported yet; use inherit.");
      if (agents.some((agent) => agent.id === id)) throw new Error("Duplicate agent identifier.");
      agents.push({ id, title: id, description: fields.description.trim(), systemPrompt: front[2].trim(), tools: toolNames(fields.tools) ?? "all", disallowedTools: toolNames(fields.disallowedTools) });
    } catch (error) { issues.push({ component: `agents/${file}`, detail: error instanceof Error ? error.message : String(error) }); }
  }
  return { agents, issues };
}
