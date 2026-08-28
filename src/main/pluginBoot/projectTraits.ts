// 项目特征探测（纯函数面）：宿主读盘产出 ProjectFacts，此处零 IO 推导
// traits，供提示词服务的 when 条件片段消费。脊柱无 IO 纪律的落点之一。
import type { ProjectTraits } from "@innocenceharness/harness-system-prompt";

export interface ProjectFacts {
  platform: { os: string; shell: string };
  rootPackageJson:
    | { devDependencies?: Record<string, string>; workspaces?: unknown }
    | undefined;
  lockfiles: readonly string[];
  topEntries: readonly string[];
}

function firstKey(deps: Record<string, string> | undefined, keys: readonly string[]): string | undefined {
  if (!deps) return undefined;
  return keys.find((k) => deps[k] !== undefined);
}

export function detectProjectTraits(facts: ProjectFacts): ProjectTraits {
  const dev = facts.rootPackageJson?.devDependencies;
  const os = facts.platform.os;
  const shell = facts.platform.shell;
  const result: Record<string, string> = { os, shell };
  const language = firstKey(dev, ["typescript"]) ? "typescript"
    : facts.topEntries.includes("tsconfig.json") ? "typescript"
    : firstKey(dev, ["esbuild", "vite"]) ? "javascript"
    : undefined;
  if (language) result.language = language;
  const test = firstKey(dev, ["vitest", "jest", "mocha"]);
  if (test) result.test = test;
  const framework = firstKey(dev, ["electron", "next", "vite", "react", "vue", "svelte"]);
  if (framework) result.framework = framework;
  const pkgmanager = facts.lockfiles.includes("pnpm-lock.yaml") ? "pnpm"
    : facts.lockfiles.includes("yarn.lock") ? "yarn"
    : facts.lockfiles.includes("bun.lockb") ? "bun"
    : facts.lockfiles.includes("package-lock.json") ? "npm"
    : undefined;
  if (pkgmanager) result.pkgmanager = pkgmanager;
  const monorepo = facts.rootPackageJson?.workspaces !== undefined || facts.topEntries.includes("packages");
  if (monorepo) result.monorepo = "workspaces";
  return result;
}
