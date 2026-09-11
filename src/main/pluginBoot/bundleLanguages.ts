import path from "node:path";
import { mkdir } from "node:fs/promises";
import { bundleManifest, readBundleLanguageServers } from "@innocenceharness/harness-plugin-catalog";
import type { LspServerDescriptor } from "@innocenceharness/harness-lsp";
import { bundleServerName } from "./bundleCapabilities";

export async function collectBundleLanguages(entries: readonly { id: string; dir: string }[], dataRoot: string, warn: (message: string) => void): Promise<LspServerDescriptor[]> {
  const result: LspServerDescriptor[] = [];
  for (const { id, dir } of entries) {
    try {
      const data = path.join(dataRoot, id);
      const loaded = await readBundleLanguageServers(dir, await bundleManifest(dir), { root: dir, data, env: process.env });
      for (const issue of loaded.issues) warn(`${id}: ${issue.component}: ${issue.detail}`);
      if (Object.keys(loaded.servers).length) await mkdir(data, { recursive: true });
      for (const [name, server] of Object.entries(loaded.servers)) result.push({ ...server, id: bundleServerName(id, name) });
    } catch (error) { warn(`${id}: ${String(error)}`); }
  }
  return result;
}
