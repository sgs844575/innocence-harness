import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { exists, json, record, safePath, string, within } from "./files";
import type { PluginMetadata } from "./protocol";
import { readBundleServers } from "./bundleServers";
import { readBundleAgents } from "./bundleAgents";
import { readBundleHooks } from "./bundleHooks";
import { readBundleLanguageServers } from "./bundleLanguageServers";

export const bundleManifests = [".codex-plugin/plugin.json", ".claude-plugin/plugin.json"];
export async function bundleManifest(root: string): Promise<Record<string, unknown> | undefined> {
  for (const file of bundleManifests) {
    if (await exists(path.join(root, file))) return record(await json(await safePath(root, file)));
  }
  return undefined;
}
/** Component paths are relative to the installed root; external host mappings are not executable components. */
export async function componentFiles(root: string, kind: "skills" | "commands" | "agents", manifest?: Record<string, unknown>): Promise<string[]> {
  const config = manifest?.[kind];
  if (config !== undefined && typeof config !== "string" && !(Array.isArray(config) && config.every((value) => typeof value === "string"))) throw new Error(`Invalid ${kind} component paths.`);
  const configured = config === undefined ? [kind] : typeof config === "string" ? [config] : Array.isArray(config) && config.every((v) => typeof v === "string") ? config as string[] : [];
  const paths = new Set<string>();
  const visit = async (relative: string): Promise<void> => {
    const file = within(root, relative);
    if (!await exists(file)) {
      if (config !== undefined) throw new Error(`Missing ${kind} component: ${relative}`);
      return;
    }
    await safePath(root, relative);
    if ((await stat(file)).isFile()) {
      if (kind === "skills" ? path.basename(file) === "SKILL.md" : file.endsWith(".md")) paths.add(relative);
      return;
    }
    for (const entry of await readdir(file, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Component paths cannot contain symbolic links.");
      if (entry.isDirectory() || entry.isFile()) await visit(`${relative}/${entry.name}`);
    }
  };
  for (const relative of [...new Set([kind, ...configured])]) {
    if (relative === kind && !configured.includes(kind) && !await exists(within(root, kind))) continue;
    await visit(relative);
  }
  return [...paths];
}
export async function inspectPlugin(root: string): Promise<PluginMetadata> {
  const manifest = await bundleManifest(root);
  const pkg = record(manifest ?? await json(path.join(root, "package.json")));
  if (!string(pkg.name)) throw new Error("No valid plugin manifest or package descriptor found.");
  const components: string[] = [];
  const unsupported: string[] = [];
  if (manifest) {
    for (const kind of ["skills", "commands"] as const) {
      if ((await componentFiles(root, kind, manifest)).length) components.push(kind);
      if (manifest[kind] !== undefined && typeof manifest[kind] !== "string" && !Array.isArray(manifest[kind])) unsupported.push(kind);
    }
    const servers = await readBundleServers(root, manifest);
    const agents = await readBundleAgents(root, manifest);
    const hooks = await readBundleHooks(root, manifest);
    const languages = await readBundleLanguageServers(root, manifest);
    if (hooks.hooks.length) components.push("hooks");
    if (Object.keys(languages.servers).length) components.push("lspServers");
    unsupported.push(...[...hooks.issues, ...languages.issues].map((issue) => `${issue.component}: ${issue.detail}`));
    if (Object.keys(servers.servers).length) components.push("mcpServers");
    if (agents.agents.length) components.push("agents");
    unsupported.push(...[...servers.issues, ...agents.issues].map((issue) => `${issue.component}: ${issue.detail}`));
    for (const [key, fallback] of [["apps", ".app.json"], ["outputStyles", "output-styles"]]) {
      if (manifest[key] !== undefined || await exists(path.join(root, fallback))) unsupported.push(key);
    }
    if (Array.isArray(manifest.dependencies) && manifest.dependencies.length) unsupported.push("dependencies");
  } else {
    if (!await exists(path.join(root, "dist/index.js"))) unsupported.push("buildRequired");
    else { await safePath(root, "dist/index.js"); components.push("runtime"); }
  }
  const ui = record(pkg.interface);
  return { name: string(pkg.name), title: string(ui.displayName) || string(pkg.name), description: string(ui.shortDescription) || string(pkg.description), version: string(pkg.version) || "unversioned", format: manifest ? "bundle" : "native", components, unsupported, installable: components.length > 0 && !unsupported.includes("dependencies") };
}
