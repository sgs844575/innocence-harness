// 用户根插件扫描（会话组装路径现算，不随 boot 单例缓存——新装插件下次
// 会话构建即生效）。descriptor 生成走可扩展的格式探测接口：当前仅原生
// 格式（package.json [+ dist/index.js]）；外部生态格式适配器为后续批次，
// 从 UserPluginFormatProbe 这条缝接入。
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PluginDescriptor } from "../plugin-toggles-local";

export interface UserPluginScanResult {
  descriptors: PluginDescriptor[];
  warnings: string[];
}

export interface UserPluginFormatProbe {
  readonly format: string;
  /** 探测目录是否属于本格式（dir 内条目清单已给出）。 */
  matches(entries: readonly string[]): boolean;
  /** 产出描述符；无法解析时返回 undefined（由调用方告警）。 */
  describe(id: string, dir: string, readPackageJson: (file: string) => Promise<unknown>): Promise<PluginDescriptor | undefined>;
}

function validSegment(value: string): boolean {
  return value.length > 0 && value.trim() === value && !/[\\/:]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const nativeProbe: UserPluginFormatProbe = {
  format: "native",
  matches: (entries) => entries.includes("package.json"),
  async describe(id, dir, readPackageJson) {
    const pkg = await readPackageJson(path.join(dir, "package.json"));
    if (!isRecord(pkg)) return undefined;
    const meta = isRecord(pkg.innocenceharness) && isRecord(pkg.innocenceharness.agentMode) ? pkg.innocenceharness.agentMode : undefined;
    const title = meta && typeof meta.title === "string" && meta.title ? meta.title
      : typeof pkg.description === "string" && pkg.description ? pkg.description
      : id;
    return {
      id,
      dependencies: [],
      toggleable: true,
      title,
      ...(meta ? { kind: "agent-mode" as const } : {}),
    };
  },
};

export async function scanUserPlugins(
  userRoot: string,
  probes: readonly UserPluginFormatProbe[] = [nativeProbe],
): Promise<UserPluginScanResult> {
  const descriptors: PluginDescriptor[] = [];
  const warnings: string[] = [];
  let dirs: string[] = [];
  try {
    dirs = (await readdir(userRoot, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return { descriptors, warnings }; // 根不存在 = 没有用户插件
  }
  for (const name of dirs) {
    if (!validSegment(name)) {
      warnings.push(`user plugin directory has unsafe name; skipped: ${name}`);
      continue;
    }
    const dir = path.join(userRoot, name);
    const entries = (await readdir(dir)).map((e) => e);
    const probe = probes.find((p) => p.matches(entries));
    if (!probe) {
      warnings.push(`user plugin directory has no known format; skipped: ${name}`);
      continue;
    }
    const descriptor = await probe.describe(name, dir, async (file) =>
      readFile(file, "utf8").then((t) => JSON.parse(t)).catch(() => undefined),
    ).catch(() => undefined);
    if (!descriptor) {
      warnings.push(`user plugin descriptor unreadable; skipped: ${name}`);
      continue;
    }
    descriptors.push(descriptor);
  }
  return { descriptors, warnings };
}
