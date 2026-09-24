// 外部生态 hooks 声明解析（turnEnd 波）：把参考生态插件布局的
// hooks/hooks.json（事件名 → 匹配组数组，组内 hooks 为 {type:"command",
// command, timeout(秒)} 列表）映射为本包的 HookDefinition 词汇表。
// 映射表：PreToolUse→preToolCall、PostToolUse→postToolCall、
// UserPromptSubmit→userPromptSubmit、SessionStart→sessionStart、
// SessionStop→sessionStop、Stop→turnEnd。未覆盖的生态事件（子代理停止、
// 压缩前、通知等）逐条告警跳过，一条坏声明不拖垮整份文件。
// matcher 按生态原义登记为正则（matchKind:"regex"，语法非法整组跳过）；
// 命令先展开插件根变量、再按引号感知规则预切分执行词元（commandTokens），
// 使带引号的路径命令在本包无 shell 执行面上可运行。
import {
  MAX_HOOK_TIMEOUT_MS,
  type HookDefinition,
  type HookEvent,
} from "./config";

/** 生态事件名 → 本包事件名；未列出的事件名按告警跳过处理。 */
export const ECOSYSTEM_EVENT_MAP: Record<string, HookEvent> = {
  PreToolUse: "preToolCall",
  PostToolUse: "postToolCall",
  UserPromptSubmit: "userPromptSubmit",
  SessionStart: "sessionStart",
  SessionStop: "sessionStop",
  Stop: "turnEnd",
};

export interface EcosystemHooksParseOptions {
  /**
   * Installed root of the plugin that owns this document, substituted for
   * the ecosystem plugin-root variables (both external spellings, matching
   * the bundle-server convention) inside hook commands. Absent leaves the
   * placeholders verbatim.
   */
  readonly pluginRoot?: string;
}

export interface EcosystemHooksParse {
  hooks: HookDefinition[];
  warnings: string[];
}

interface EcosystemCommandEntry {
  type?: unknown;
  command?: unknown;
  timeout?: unknown;
}

/** 外部生态 matcher 是 JavaScript 正则（对主体做未锚定搜索）；这里仅做
 *  语法校验，真正的编译在匹配点（matching.ts）带缓存进行。 */
function isRegularExpression(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** 命令里的插件根变量拼写：外部协议键，不是宿主环境别名。其余 ${…} 引用
 *  原样保留——hook 继承运行期进程环境，解析期不做任意环境展开。 */
const PLUGIN_ROOT_VARIABLE = /\$\{(PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)(?::-([^}]*))?\}/g;

function expandPluginRootVariables(text: string, pluginRoot: string | undefined): string {
  if (pluginRoot === undefined) return text;
  // 插件根恒优先（与 bundle 服务器侧的同名展开一致），缺省拼写仅作兜底。
  return text.replace(PLUGIN_ROOT_VARIABLE, () => pluginRoot);
}

/**
 * 引号感知的命令切分：外部生态命令按 shell 习惯书写，可执行路径常带引号
 * （路径可含空格）。双/单引号段原样并入词元（不处理转义）；引号未闭合
 * 返回 null（按坏声明跳过）。无引号的命令与空白切分等价。
 */
export function tokenizeEcosystemCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: string | null = null;
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote !== null) return null;
  if (started) tokens.push(current);
  return tokens;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析一份生态 hooks 文档。接受两种顶层形状：{"hooks": {事件: [...]}}
 * （hooks.json 文件）或直接的 {事件: [...]}（设置片段内嵌形状）。
 */
export function parseEcosystemHooksDocument(
  raw: unknown,
  options?: EcosystemHooksParseOptions,
): EcosystemHooksParse {
  const hooks: HookDefinition[] = [];
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { hooks, warnings: ["ecosystem hooks document must be a JSON object"] };
  }
  const eventMap = isRecord(raw.hooks) ? raw.hooks : raw;
  for (const [eventName, groups] of Object.entries(eventMap)) {
    const mapped = ECOSYSTEM_EVENT_MAP[eventName];
    if (mapped === undefined) {
      warnings.push(`ecosystem hook event "${eventName}" has no mapping; skipped`);
      continue;
    }
    if (!Array.isArray(groups)) {
      warnings.push(`ecosystem hook event "${eventName}" must be an array of matcher groups`);
      continue;
    }
    groups.forEach((group, groupIndex) => {
      const where = `${eventName}[${groupIndex}]`;
      if (!isRecord(group)) {
        warnings.push(`${where}: matcher group must be an object`);
        return;
      }
      const matcher = group.matcher;
      if (matcher !== undefined && typeof matcher !== "string") {
        warnings.push(`${where}: matcher must be a string when present`);
        return;
      }
      // matcher 非空即按正则登记（空串与缺省同义：命中全部）；语法非法的
      // 正则永不命中，直接跳过该组而不是装载一条哑声明。
      let match: { match: string; matchKind: "regex" } | undefined;
      if (typeof matcher === "string" && matcher.trim() !== "") {
        const pattern = matcher.trim();
        if (!isRegularExpression(pattern)) {
          warnings.push(`${where}: matcher "${matcher}" is not a valid regular expression; skipped`);
          return;
        }
        match = { match: pattern, matchKind: "regex" };
      }
      const commands = group.hooks;
      if (!Array.isArray(commands) || commands.length === 0) {
        warnings.push(`${where}: matcher group needs a non-empty "hooks" array`);
        return;
      }
      commands.forEach((entry, commandIndex) => {
        const commandWhere = `${where}.hooks[${commandIndex}]`;
        if (!isRecord(entry)) {
          warnings.push(`${commandWhere}: hook entry must be an object`);
          return;
        }
        const typed = entry as EcosystemCommandEntry;
        if (typed.type !== "command") {
          warnings.push(`${commandWhere}: only "command" hooks are supported; skipped`);
          return;
        }
        if (typeof typed.command !== "string" || typed.command.trim() === "") {
          warnings.push(`${commandWhere}: command must be a non-empty string`);
          return;
        }
        // 插件根变量先展开，再按引号感知规则切分执行词元；引号未闭合或
        // 切出空词元（空引号段）按坏声明告警跳过（运行期只会 ENOENT/拒绝
        // 装载，提前给出可定位的告警）。
        const expanded = expandPluginRootVariables(typed.command, options?.pluginRoot);
        const tokens = tokenizeEcosystemCommand(expanded);
        if (tokens === null || tokens.length === 0 || tokens.some((token) => token.trim() === "")) {
          warnings.push(`${commandWhere}: command quoting is malformed; skipped`);
          return;
        }
        let timeoutMs: number | undefined;
        if (typed.timeout !== undefined) {
          // 生态以秒计；折算毫秒并按本包上限收敛（超限告警）。
          if (typeof typed.timeout !== "number" || !Number.isFinite(typed.timeout) || typed.timeout <= 0) {
            warnings.push(`${commandWhere}: timeout must be a positive number of seconds`);
            return;
          }
          const converted = Math.round(typed.timeout * 1000);
          if (converted > MAX_HOOK_TIMEOUT_MS) {
            warnings.push(`${commandWhere}: timeout ${typed.timeout}s exceeds the ceiling and was clamped to ${MAX_HOOK_TIMEOUT_MS}ms`);
          }
          timeoutMs = Math.min(converted, MAX_HOOK_TIMEOUT_MS);
        }
        hooks.push({
          event: mapped,
          command: expanded.trim(),
          commandTokens: tokens,
          ...(match !== undefined ? match : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
      });
    });
  }
  return { hooks, warnings };
}
