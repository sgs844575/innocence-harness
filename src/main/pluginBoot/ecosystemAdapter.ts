// 外部生态插件（claude-code 布局）的内核插件包装：commands/*.md 与
// skills/*/SKILL.md 映射为 harness 技能（经既有技能索引与 /name 展开通道
// 生效）；agents/*.md 为子代理人设——预设注入通道未立，本批跳过并告警；
// hooks 等其余目录同理。适配器只读外部目录、不写盘 shim、不持有资源；
// 逐文件读取/解析失败降级为告警，不中断其余文件。
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "@innocenceharness/plugin-skills";
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";

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
      // 1) skills/<name>/SKILL.md → parseSkillMarkdown（null 告警跳过，无降级）。
      for (const name of await listDir(path.join(dir, "skills"), warn)) {
        const rel = path.join("skills", name, "SKILL.md");
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
      for (const name of (await listDir(path.join(dir, "commands"), warn)).filter((n) => n.endsWith(".md"))) {
        const file = path.join(dir, "commands", name);
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
      // 3) agents/（子代理人设）与 hooks/（生命周期钩子）：预设注入通道与
      //    钩子桥未立，整目录跳过并告警（不注册任何内容）。
      for (const [sub, reason] of [["agents", "subagent personas"], ["hooks", "lifecycle hooks"]] as const) {
        if ((await listDir(path.join(dir, sub), warn)).length > 0) {
          warn({ directory: sub, warning: `${reason} are not supported yet; directory skipped` });
        }
      }
    },
  };
}
