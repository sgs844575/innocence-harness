import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Context } from "@innocenceharness/kernel";
import type { Skill } from "@innocenceharness/harness-skills";
import type { Message, MessagePart } from "@innocenceharness/harness-session";

// ctx.logger 的类型可见性：kernel-logger 不自带 Context 增强，这里按
// session 组合侧（harness-electron/session-kernel）的同一声明就地合并（成员
// 类型逐字一致，同程序内合并合法），包自身不依赖宿主适配层。
declare module "@innocenceharness/kernel" {
  interface Context {
    logger: import("@innocenceharness/kernel-logger").LoggerService;
  }
}

export interface ParsedSkillFile {
  name: string;
  description: string;
  body: string;
}

/**
 * Parses a SKILL.md file: `---`-delimited YAML frontmatter (name,
 * description), body after the closing fence. Malformed frontmatter
 * degrades to null — the entry is skipped, never fatal.
 */
export function parseSkillMarkdown(raw: string): ParsedSkillFile | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;
  let meta: unknown;
  try {
    meta = parseYaml(match[1]);
  } catch {
    return null;
  }
  const name = stringField(meta, "name");
  const description = stringField(meta, "description");
  if (!name || !description) return null;
  return { name, description, body: match[2].trim() };
}

function stringField(meta: unknown, key: string): string | undefined {
  if (typeof meta !== "object" || meta === null) return undefined;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : undefined;
}

async function loadSkillFrom(dir: string, entry: string): Promise<Skill | null> {
  const skillPath = path.join(dir, entry, "SKILL.md");
  const file = path.join(dir, entry);
  const target = await fs.stat(file).catch(() => null);
  if (!target) return null;
  const rawPath = target.isDirectory() ? skillPath : file;
  const raw = await fs.readFile(rawPath, "utf8").catch(() => null);
  if (raw === null) return null;
  const parsed = parseSkillMarkdown(raw);
  if (!parsed) return null;
  return {
    name: parsed.name,
    description: parsed.description,
    loadBody: async () => parsed.body,
  };
}

export interface SkillsPluginOptions {
  /** Directories to scan; each subdirectory (or *.md file) may hold a SKILL.md.
   *  多根语义：根序即优先序——前根同名技能优先，后根同名在扫描层跳过。 */
  dirs: string[];
}

/** The skills service face the expansion needs (subset of the spine face). */
interface SkillsLookup {
  get(name: string): Skill | undefined;
  all(): readonly Skill[];
}

/**
 * Pipeline order of the expansion processor: strictly ahead of the
 * conventionally-numbered processors (hosts register theirs at 0), so
 * downstream processors see the expanded text — the pre-migration session
 * expanded user input before running any processor.
 */
const SKILL_EXPANSION_ORDER = -1000;

/** Invocation prefix: "/skillname" optionally followed by the turn text. */
const SKILL_INVOCATION_RE = /^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the text mentions a recorded skill name as a word but does not
 * open with its invocation form. Word boundaries keep longer derived words
 * from triggering; the invocation exclusion is case-insensitive so a miscased
 * "/Name" (which the case-sensitive expansion does not catch) still counts as
 * intent to invoke rather than as a prose mention.
 */
function mentionsSkill(text: string, name: string): boolean {
  if (new RegExp(`^\\/${escapeRegExp(name)}`, "i").test(text.trim())) return false;
  return new RegExp(`(?<![a-zA-Z0-9_-])${escapeRegExp(name)}(?![a-zA-Z0-9_-])`, "i").test(text);
}

/**
 * Wraps one injected note body in the shared reminder envelope (same shape
 * as the reminders plugin's; kept local so the two plugins stay
 * independent).
 */
function envelope(body: string): string {
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

/**
 * The re-mention note body (source: system-reminder-previously-invoked-skills.md,
 * adapted to the mention-not-invocation case, converged to two sentences):
 * the named skills were already expanded in this session; a plain mention is
 * not a reload — re-run the slash form only when the full text is needed.
 */
function mentionNoteBody(names: readonly string[]): string {
  const slashForms = names.map((name) => `/${name}`).join(" or ");
  return (
    `Skill ${names.join(", ")} was expanded earlier in this session. ` +
    `A plain mention does not reload it — run ${slashForms} again if the full text is needed.`
  );
}

/**
 * Runs skill expansion over one message and collects prose mentions of
 * previously expanded skills. Only the targeted text parts change; every
 * other part is kept as-is, in order. Mention detection reads the ORIGINAL
 * text of non-expanding parts (expanded bodies routinely contain their own
 * skill name).
 */
async function expandUserMessage(
  message: Message,
  skills: SkillsLookup,
  expandedNames: Set<string>,
): Promise<{ message: Message; mentions: string[] }> {
  if (skills.all().length === 0 && expandedNames.size === 0) {
    return { message, mentions: [] };
  }
  const parts: MessagePart[] = [];
  const mentions = new Set<string>();
  let changed = false;
  for (const part of message.parts) {
    if (part.type !== "text") {
      parts.push(part);
      continue;
    }
    const invocation = SKILL_INVOCATION_RE.exec(part.text.trim());
    const skill = invocation ? skills.get(invocation[1]) : undefined;
    if (skill) {
      changed = true;
      expandedNames.add(skill.name);
      const body = await skill.loadBody();
      parts.push({
        type: "text",
        text: `[已加载技能 ${skill.name}]\n${body}\n\n[用户输入]\n${invocation![2]}`,
      });
      continue;
    }
    for (const name of expandedNames) {
      if (mentionsSkill(part.text, name)) mentions.add(name);
    }
    parts.push(part);
  }
  return {
    message: changed ? { role: message.role, parts } : message,
    mentions: [...mentions],
  };
}

/** Kernel-native skills plugin (name "skills"). */
export interface SkillsPlugin {
  readonly name: "skills";
  apply(ctx: Context): Promise<void>;
}

/**
 * Scans skill directories at apply time, registers every parseable skill on
 * the spine skills service, and registers the "/name" expansion message
 * processor (order first) on the session service — expansion runs over real
 * user input only, exactly like the pipeline-external pass it replaces.
 *
 * Multi-root semantics: root order is priority order — a skill name seen in
 * an earlier root wins; the same name in a later root is skipped at the scan
 * layer (before registration).
 */
export function createSkillsPlugin(options: SkillsPluginOptions): SkillsPlugin {
  return {
    name: "skills",
    async apply(ctx) {
      const seen = new Set<string>();
      for (const dir of options.dirs) {
        let entries: string[] = [];
        try {
          entries = await fs.readdir(dir);
        } catch {
          continue; // missing dir is normal (no skills yet)
        }
        for (const entry of entries) {
          const skill = await loadSkillFrom(dir, entry);
          if (skill && !seen.has(skill.name)) {
            // 后根同名在扫描层跳过（根序即优先序）；seen 防御根内重名。
            seen.add(skill.name);
            try {
              ctx.skills.register(skill);
              ctx.logger.log("info", `[skills] skill loaded: ${skill.name}`);
            } catch {
              // 根内同名（同批 loadSkillFrom 重复条目）— 先到先得
            }
          }
        }
      }
      // Child sessions inherit their parent's processors (session-spawner's
      // subagent-inherit), so a subagent prompt starting with "/<skill>" also
      // expands here against this session's skill table. Accepted semantic:
      // non-destructive and narrowly triggered (normal subagent prompts do
      // not start with "/"); isolation would require a protocol change.
      //
      // The expanded-name set lives in this apply closure (session
      // composition scope): the expansion pass records every skill it
      // expanded, and a later prose turn that mentions one of those names —
      // without opening with its /name invocation form — gets a one-line
      // note appended to the message tail (mention, not invocation). The
      // note fires once per skill name (notedNames): common-word names
      // mentioned turn after turn must not re-inject the reminder every turn.
      const expandedNames = new Set<string>();
      const notedNames = new Set<string>();
      ctx.session.registerProcessor({
        name: "skill-expansion",
        order: SKILL_EXPANSION_ORDER,
        process: async (message) => {
          const { message: expanded, mentions } = await expandUserMessage(
            message,
            ctx.skills,
            expandedNames,
          );
          const fresh = mentions.filter((name) => !notedNames.has(name));
          if (fresh.length === 0) return expanded;
          for (const name of fresh) notedNames.add(name);
          return {
            role: expanded.role,
            parts: [
              ...expanded.parts,
              { type: "text" as const, text: envelope(mentionNoteBody(fresh)) },
            ],
          };
        },
      });
    },
  };
}
// Distribution default (kernel-loader unwrapExports convention): the factory,
// so a disk-loaded module resolves to the single entry point hosts configure.
export default createSkillsPlugin;
