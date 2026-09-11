import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";
import { bundleManifest, readBundleAgents, readBundleServers, type BundleAgent, type BundleServer } from "@innocenceharness/harness-plugin-catalog";
import { readBundleHooks } from "@innocenceharness/harness-plugin-catalog";
import type { EcosystemAdapterLog } from "./ecosystemAdapter";

/** Namespaces are shared by server registration and agent tool references. */
export function bundleServerName(id: string, name: string) { return `bundle_${createHash("sha256").update(id).digest("hex").slice(0, 12)}_${name}`; }
export async function collectBundleAgents(entries: readonly { id: string; dir: string }[], log: EcosystemAdapterLog): Promise<BundleAgent[]> {
  const all: BundleAgent[] = [];
  for (const { id, dir } of entries) {
    try {
      const manifest = await bundleManifest(dir);
      const loaded = await readBundleAgents(dir, manifest);
      const serverNames = Object.keys((await readBundleServers(dir, manifest)).servers).sort((a, b) => b.length - a.length);
      for (const issue of loaded.issues) log("warn", "bundle agents", { plugin: id, ...issue });
      const mapName = (name: string) => {
        const server = serverNames.find((candidate) => name.startsWith(`mcp__${candidate}__`));
        return server ? `mcp__${bundleServerName(id, server)}__${name.slice(`mcp__${server}__`.length)}` : name;
      };
      all.push(...loaded.agents.map((agent) => ({ ...agent, id: `bundle:${id}:${agent.id}`, tools: agent.tools === "all" ? "all" as const : agent.tools.map(mapName), disallowedTools: agent.disallowedTools?.map(mapName) })));
    } catch (error) { log("warn", "bundle agents", { plugin: id, error: String(error) }); }
  }
  return all;
}
export interface BundleRuntimePort {
  getDataRoot(): string;
  createServers(servers: Record<string, BundleServer>): ObjectPlugin;
  /** 生态 hooks 声明 → 会话钩子插件（turnEnd 波）；缺省 = 不支持（告警跳过）。 */
  createHooks?: (hooks: readonly unknown[]) => ObjectPlugin;
}
/** Host lifecycle adapter; the injected factory resolves the staged capability. */
export async function applyBundleServers(ctx: Context, id: string, dir: string, manifest: Record<string, unknown> | undefined, port: BundleRuntimePort, log: EcosystemAdapterLog) {
  try {
    const data = path.join(port.getDataRoot(), id);
    const loaded = await readBundleServers(dir, manifest, { root: dir, data, env: process.env });
    for (const issue of loaded.issues) log("warn", "bundle servers", { plugin: id, ...issue });
    if (!Object.keys(loaded.servers).length) return;
    await mkdir(data, { recursive: true });
    const servers = Object.fromEntries(Object.entries(loaded.servers).map(([name, config]) => [bundleServerName(id, name), { ...config, ...(/^(computer|desktop)(?:[-_].*)?$/i.test(name) ? { capability: "computer" as const } : {}) }]));
    await port.createServers(servers).apply(ctx);
  } catch (error) { log("warn", "bundle servers", { plugin: id, error: String(error) }); }
}

/** 生态 hooks/hooks.json → 本包钩子词汇表的装载（解析在 plugin-hooks 生态模块）。 */
export async function applyBundleHooks(
  ctx: Context,
  id: string,
  dir: string,
  port: BundleRuntimePort,
  log: EcosystemAdapterLog,
): Promise<boolean> {
  if (!port.createHooks) return false;
  try {
    const parsed = await readBundleHooks(dir, await bundleManifest(dir));
    if (!parsed.declared) return false;
    for (const warning of parsed.issues) log("warn", "bundle hooks", { plugin: id, warning });
    if (parsed.hooks.length === 0) return true;
    const dispose = await port.createHooks(parsed.hooks).apply(ctx);
    if (typeof dispose === "function") ctx.effect(() => dispose, "bundle hooks");
    return true;
  } catch (error) {
    // 文件缺失属正常（无 hooks 声明）；其余读取/解析失败告警跳过。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    log("warn", "bundle hooks", { plugin: id, error: String(error) });
    return false;
  }
}
