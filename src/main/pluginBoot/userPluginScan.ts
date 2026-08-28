// 用户根插件扫描（会话组装路径现算，不随 boot 单例缓存——新装插件下次
// 会话构建即生效）。descriptor 生成走可扩展的格式探测接口：原生格式
// （package.json [+ dist/index.js]）与 claude-code 外部生态布局
// （.claude-plugin/plugin.json，仅描述符探测——装载由宿主生态适配器在
// 组装时包裹，native 装载器不解析该布局）；更多外部格式沿
// UserPluginFormatProbe 这条缝接入。
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
  /** 产出描述符；无法解析时返回 undefined（由调用方告警）。readJson 读取
   * 任意 JSON 文件（读失败/解析失败返回 undefined）。 */
  describe(id: string, dir: string, readJson: (file: string) => Promise<unknown>): Promise<PluginDescriptor | undefined>;
}

function validSegment(value: string): boolean {
  // 与装载器 plain-plugin-id / 安装器谓词对齐：拒绝点前缀、路径分隔符、
  // 首尾空白（"."、".."、".hidden" 一律非法——否则会进开关空间后模块解析失败）。
  return value.length > 0 && value.trim() === value && !value.startsWith(".") && !/[\\/:]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const nativeProbe: UserPluginFormatProbe = {
  format: "native",
  matches: (entries) => entries.includes("package.json"),
  async describe(id, dir, readJson) {
    const pkg = await readJson(path.join(dir, "package.json"));
    if (!isRecord(pkg)) return undefined;
    const meta = isRecord(pkg.innocenceharness) && isRecord(pkg.innocenceharness.agentMode) ? pkg.innocenceharness.agentMode : undefined;
    const title = meta && typeof meta.title === "string" && meta.title ? meta.title
      : typeof pkg.description === "string" && pkg.description ? pkg.description
      : id;
    const metaDescription = meta && typeof meta.description === "string" && meta.description ? meta.description : undefined;
    return {
      id,
      dependencies: [],
      toggleable: true,
      title,
      ...(meta ? { kind: "agent-mode" as const } : {}),
      ...(metaDescription ? { description: metaDescription } : {}),
    };
  },
};

/** External ecosystem plugin format (claude-code layout: .claude-plugin/plugin.json
 *  plus commands/ skills/ agents/ hooks/). Descriptor only — loading is wrapped
 *  by the host ecosystem adapter at composition time (native loader never
 *  resolves this layout). */
export const claudeCodeProbe: UserPluginFormatProbe = {
  format: "claude-code",
  matches: (entries) => entries.includes(".claude-plugin"),
  async describe(id, dir, readJson) {
    const pkg = await readJson(path.join(dir, ".claude-plugin", "plugin.json"));
    if (!isRecord(pkg)) return undefined;
    const title = typeof pkg.description === "string" && pkg.description ? pkg.description
      : typeof pkg.name === "string" && pkg.name ? pkg.name : id;
    return { id, dependencies: [], toggleable: true, title, format: "claude-code" as const };
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
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      warnings.push(`user plugin directory unreadable; skipped: ${name}`);
      continue;
    }
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
