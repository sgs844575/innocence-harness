import type { Context } from "@innocenceharness/kernel";
import {
  type Tool,
  type ToolContext,
} from "@innocenceharness/harness-tools";
import { adaptedPresets } from "@innocenceharness/agent-presets";
import { withThreadNotes } from "./thread-notes";

export { SUBAGENT_THREAD_NOTES, withThreadNotes } from "./thread-notes";

/** A subagent persona preset consumed by the Task tool. */
export interface SubagentPreset {
  id: string;
  title: string;
  /** One-line purpose shown in the tool description. */
  description: string;
  /** English persona prompt (repo rule: all prompt content in English). */
  systemPrompt: string;
  tools: "readOnly" | "all";
}

/**
 * 内建预设注册表。人设正文一律英文（本仓规则：LLM 面内容英文），
 * 并按仓库现实引用工具名（Read/Glob/Grep/Bash）。
 */
export const BUILTIN_PRESETS: readonly SubagentPreset[] = [
  {
    id: "explore",
    title: "Explorer",
    description: "Read-only codebase research",
    tools: "readOnly",
    systemPrompt: [
      "You are the Read-Only Codebase Explorer of the harness: a research specialist that answers questions about the repository by navigating it, never by changing it.",
      "",
      "Operating discipline:",
      "- Strict read-only mode. Never create, modify, delete, move, or copy any file; never write temporary files; never run a command that mutates state. Reading and searching are your only permitted actions.",
      "- Navigate thoroughly. Launch searches from several plausible starting points - symbol names, imports, configuration, tests - then follow references, call sites, and definition chains until the evidence is sufficient to answer the question. Do not stop at the first superficial hit.",
      "- Use Glob to locate files by name or pattern and Grep to sweep content with keywords and regular expressions. Once a concrete path is known, Read the relevant span instead of whole files. Use Bash only for inspection commands such as listing directories or inspecting history, and batch independent lookups in parallel to stay fast.",
      "",
      "Report:",
      "Reply with one dense findings report: key conclusions first, then the supporting file paths and line numbers, and finally notable risks or unresolved questions. You locate and summarize code; you never judge style or propose rewrites. No greetings, no filler, no restating the question.",
    ].join("\n"),
  },
  {
    id: "general",
    title: "Generalist",
    description: "General-purpose task execution",
    tools: "all",
    systemPrompt: [
      "You are the Generalist agent of the harness. Your job is to carry a self-contained task through to completion with the tools and permissions you have been granted - reading files, running commands, and editing code as the work requires.",
      "",
      "Working rules:",
      "- The task description is your full context. Proceed autonomously: investigate, decide, and act instead of asking the caller questions it cannot answer.",
      "- Match effort to the stated goal: finish the job completely, without gold-plating past the request and without abandoning required work.",
      "- Search wide when you cannot predict where something lives; read precisely once concrete paths emerge; verify changes by building or testing when the repository supports it.",
      "- If policy denies a tool call, never repeat the same operation - pick a different approach or report the denial as a blocking constraint.",
      "- This assignment already has a dedicated agent: you. Do the work yourself instead of handing the entire task off to another agent.",
      "",
      "Final report:",
      "Lead with the conclusion, then state compactly what was done, what changed, and what the caller should look at next. No greetings, no filler.",
    ].join("\n"),
  },
];

/** 预设目录行：`id — title: description`（目录行内容为英文字面量）。 */
function catalogLines(presets: readonly SubagentPreset[]): string {
  return presets.map((p) => `${p.id} — ${p.title}: ${p.description}`).join("\n");
}

/** Task tool factory: derives the agentType enum and description from the preset registry. */
export function createTaskTool(presets: readonly SubagentPreset[]): Tool {
  const byId = new Map(presets.map((p) => [p.id, p]));
  const ids = presets.map((p) => p.id);
  const fallbackId = ids[0] ?? "";
  const pickAgentType = (value: unknown): string =>
    typeof value === "string" && byId.has(value) ? value : fallbackId;
  return {
    name: "Task",
    description:
      "派生一个隔离子代理去完成一项独立任务，适合并行研究和探索（子代理的中间过程不占用当前上下文）。" +
      "prompt 里给足自包含的上下文和目标。可用预设：\n" +
      catalogLines(presets),
    readOnly: false,
    // 副作用发生在子会话内、由子会话自行审计——父级不得重复记账（P1 依赖此值）。
    sideEffect: "delegated",
    parameters: {
      type: "object",
      properties: {
        agentType: {
          type: "string",
          enum: ids,
          description: "子代理预设类型（见工具描述目录）",
        },
        description: { type: "string", description: "一句话任务摘要" },
        prompt: { type: "string", description: "自包含的任务描述（目标、范围、期望产出）" },
        inheritContext: {
          type: "boolean",
          description:
            "继承父会话最近对话上下文（近 50 条消息种子进子代理并附继承简报；适合延续父任务的工作树/同工作区协作。默认 false = 全新上下文，prompt 需自包含）",
        },
      },
      required: ["agentType", "prompt"],
    },
    async validateArgs(args) {
      const prompt = args.prompt;
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        throw new Error("缺少必填参数 prompt（自包含的任务描述）");
      }
      const agentType = args.agentType;
      if (typeof agentType !== "string" || !byId.has(agentType)) {
        // 只列合法值，绝不回显入参内容。
        throw new Error(`无效的 agentType（合法值：${ids.join(", ")}）`);
      }
    },
    permissionResource(args) {
      // 资源以代理预设类型标识（spawn:agent/<preset>）。
      return {
        action: "spawn",
        kind: "agent",
        scope: pickAgentType(args.agentType),
      };
    },
    persistArgs(args) {
      // 持久化完整原文供展示/留档：预设类型、prompt 原文、description 原文（如有），
      // inheritContext 为布尔开关，原样持久化。
      return {
        agentType: pickAgentType(args.agentType),
        prompt: typeof args.prompt === "string" ? args.prompt : "",
        ...(typeof args.description === "string" && args.description
          ? { description: args.description }
          : {}),
        ...(args.inheritContext === true ? { inheritContext: true } : {}),
      };
    },
    async execute(args, ctx: ToolContext) {
      const agentType = pickAgentType(args.agentType);
      const preset = byId.get(agentType)!;
      const prompt = args.prompt;
      const description = args.description;
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        throw new Error("缺少必填参数 prompt（自包含的任务描述）");
      }
      if (!ctx.subagent) {
        return {
          content: "当前宿主不支持子代理（缺少 spawner）",
          isError: true,
        };
      }
      const header = typeof description === "string" && description ? `【${description}】\n` : "";
      const result = await ctx.subagent.run({
        // 人设 + 线程注记（M3）：注记是系统级线程纪律，逐线程附加，不入预设。
        systemPrompt: withThreadNotes(preset.systemPrompt),
        tools: preset.tools,
        agentType,
        prompt,
        description: typeof description === "string" ? description : undefined,
        signal: ctx.signal,
        // S2b 上下文继承请求：由 loop 绑定的 spawner 兑现（无绑定时降级全新上下文）。
        ...(args.inheritContext === true ? { inheritContext: true } : {}),
      });
      const isError = result.completion?.finishReason === "error";
      return {
        content:
          (header + result.finalText).trim() || "[子代理没有产出文本]",
        ...(isError ? { isError: true } : {}),
      };
    },
  };
}

/** Subagent plugin options: extra presets override built-ins by id. */
export interface SubagentPluginOptions {
  extraPresets?: readonly SubagentPreset[];
}

/** 按 id 去重合并（extra 同 id 覆盖内建），注册由合并结果派生的 Task 工具。 */
export function createSubagentPlugin(options: SubagentPluginOptions = {}) {
  const merged = new Map<string, SubagentPreset>();
  for (const preset of BUILTIN_PRESETS) merged.set(preset.id, preset);
  for (const preset of options.extraPresets ?? []) merged.set(preset.id, preset);
  const presets = [...merged.values()];
  return {
    name: "subagent",
    apply(ctx: Context) {
      ctx.tools.register(createTaskTool(presets));
    },
  };
}

/** Subagent plugin — registers the Task tool with built-in plus adapted presets. */
export const SubagentPlugin = createSubagentPlugin({ extraPresets: adaptedPresets });
export default SubagentPlugin;
