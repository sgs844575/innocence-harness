// Bundle presentation adapter: skills register on the spine; server lifecycle
// belongs to the injected staged factory. Agent presets are collected before
// composing the Task capability, independently of plugin load order.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "@innocenceharness/plugin-skills";
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";
import { bundleManifest, componentFiles } from "@innocenceharness/harness-plugin-catalog";
import { applyBundleHooks, applyBundleServers, type BundleRuntimePort } from "./bundleCapabilities";

/** 宿主告警缝：level/channel/detail 与组合根 options.log 对齐。 */
export interface EcosystemAdapterLog {
  (level: "warn", channel: string, detail: Record<string, unknown>): void;
}

/** 降级 description 的截断长度（正文首行投影）。 */
const DESCRIPTION_LIMIT = 80;

interface MappedSkill {
  name: string;
  description: string;
  body: string;
}

/** commands/*.md 无 frontmatter 时的降级投影：name=文件去扩展名、
 * description=正文首行（截 80 字符，空文回落插件 id）、body=全文。 */
function degradeCommandSkill(file: string, raw: string, id: string): MappedSkill {
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return {
    name: path.basename(file, path.extname(file)),
    description: firstLine.slice(0, DESCRIPTION_LIMIT) || id,
    body: raw.trim(),
  };
}

async function listDir(dir: string, warn: (detail: Record<string, unknown>) => void): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).map((entry) => entry.name);
  } catch (error) {
    // 目录缺失（ENOENT）= 没有该类内容，属正常；其余读取失败告警跳过。
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warn({ directory: dir, warning: "directory unreadable; skipped", error: String(error) });
    }
    return [];
  }
}

/**
 * 外部生态布局 → 内核插件对象：apply 时扫描目录并把 commands/skills 投影
 * 为技能注册。不写盘、不持有资源；descriptor 停用由组合层负责（条目不组
 * 装，apply 不会发生）。
 */
export function createEcosystemAdapterPlugin(
  id: string,
  dir: string,
  log: EcosystemAdapterLog,
  runtime?: BundleRuntimePort,
): ObjectPlugin {
  const warn = (detail: Record<string, unknown>): void => {
    log("warn", "ecosystem adapter", { plugin: id, ...detail });
  };

  const registerSkill = (ctx: Context, skill: MappedSkill): void => {
    try {
      ctx.skills.register({
        name: skill.name,
        description: skill.description,
        loadBody: async () => skill.body,
      });
    } catch (error) {
      // 同名遵循技能服务既有语义（重复名抛错先到先得）：告警跳过该件。
      warn({ skill: skill.name, warning: "duplicate skill registration; skipped", error: String(error) });
    }
  };

  return {
    name: `ecosystem:${id}`,
    async apply(ctx) {
      const manifest = await bundleManifest(dir);
      // 1) skills/<name>/SKILL.md → parseSkillMarkdown（null 告警跳过，无降级）。
      for (const rel of await componentFiles(dir, "skills", manifest)) {
        let raw: string;
        try {
          raw = await readFile(path.join(dir, rel), "utf8");
        } catch (error) {
          warn({ file: rel, warning: "skill file unreadable; skipped", error: String(error) });
          continue;
        }
        const parsed = parseSkillMarkdown(raw);
        if (!parsed) {
          warn({ file: rel, warning: "skill frontmatter malformed; skipped" });
          continue;
        }
        registerSkill(ctx, parsed);
      }
      // 2) commands/*.md → parseSkillMarkdown；无 frontmatter 降级文件名投影
      //    （有 fence 但解析失败不降级——按坏格式告警跳过）。
      for (const name of await componentFiles(dir, "commands", manifest)) {
        const file = path.join(dir, name);
        let raw: string;
        try {
          raw = await readFile(file, "utf8");
        } catch (error) {
          warn({ file: name, warning: "command file unreadable; skipped", error: String(error) });
          continue;
        }
        const parsed = parseSkillMarkdown(raw);
        if (parsed) {
          registerSkill(ctx, parsed);
        } else if (!raw.startsWith("---")) {
          registerSkill(ctx, degradeCommandSkill(name, raw, id));
        } else {
          warn({ file: name, warning: "command frontmatter malformed; skipped" });
        }
      }
      // Server resources unwind with this plugin fiber; lifecycle hooks from
      // the ecosystem hooks/ directory map onto the native hook vocabulary
      // (turnEnd wave) — mounted through the runtime port, gated by the same
      // first-encounter permission gate as every other hook command.
      if (runtime) await applyBundleServers(ctx, id, dir, manifest, runtime, log);
      if (runtime?.createHooks) {
        await applyBundleHooks(ctx, id, dir, runtime, log);
      } else if ((await listDir(path.join(dir, "hooks"), warn)).length > 0) {
        warn({ directory: "hooks", warning: "lifecycle hooks need a newer host runtime; directory skipped" });
      }
    },
  };
}
