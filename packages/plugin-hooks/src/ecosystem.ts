// 外部生态 hooks 声明解析（turnEnd 波）：把参考生态插件布局的
// hooks/hooks.json（事件名 → 匹配组数组，组内 hooks 为 {type:"command",
// command, timeout(秒)} 列表）映射为本包的 HookDefinition 词汇表。
// 映射表：PreToolUse→preToolCall、PostToolUse→postToolCall、
// UserPromptSubmit→userPromptSubmit、SessionStart→sessionStart、
// SessionStop→sessionStop、Stop→turnEnd。未覆盖的生态事件（子代理停止、
// 压缩前、通知等）逐条告警跳过，一条坏声明不拖垮整份文件。
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

export interface EcosystemHooksParse {
  hooks: HookDefinition[];
  warnings: string[];
}

interface EcosystemCommandEntry {
  type?: unknown;
  command?: unknown;
  timeout?: unknown;
}

const REGEX_METACHARACTERS = /[\\^$.*+?()[\]{}|]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析一份生态 hooks 文档。接受两种顶层形状：{"hooks": {事件: [...]}}
 * （hooks.json 文件）或直接的 {事件: [...]}（设置片段内嵌形状）。
 */
export function parseEcosystemHooksDocument(raw: unknown): EcosystemHooksParse {
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
      if (matcher !== undefined && REGEX_METACHARACTERS.test(matcher)) {
        // 本包的 match 是字面相等/前缀语义，不支持生态的正则形态——按字面
        // 处理通常只是永不命中，显式告警让作者改写为字面名。
        warnings.push(`${where}: matcher "${matcher}" carries pattern characters; it is matched literally and may never fire`);
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
          command: typed.command.trim(),
          ...(typeof matcher === "string" && matcher.trim() !== "" ? { match: matcher.trim() } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
      });
    });
  }
  return { hooks, warnings };
}
