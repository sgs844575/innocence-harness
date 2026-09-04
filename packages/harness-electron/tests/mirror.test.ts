// Drift guard：shared 的 PROVIDER_PRESET_MIRROR 必须与 harness-electron 的
// PROVIDER_PRESETS 逐家对齐（渲染层无法 import node 侧包，镜像一旦漂移，
// AddProviderDialog 展示/创建的预设就会与出厂默认不一致）。
import { describe, expect, it } from "vitest";
import {
  MOCK_MODEL,
  MOCK_PROFILE_ID,
  PROVIDER_PRESET_MIRROR,
  isChatQuestionResponse,
  type ChatPermissionEvent,
  type ChatQuestionAnswerItem,
  type ChatQuestionEvent,
  type ChatQuestionItem,
  type ChatQuestionOption,
  type ChatQuestionResponse,
  type DiscoveredSkillMirror as SharedDiscoveredSkill,
  type HarnessSettings as SharedHarnessSettings,
  type McpImportResultMirror,
  type McpServerEntryMirror,
  type ProviderKind as SharedProviderKind,
  type SubagentLifecycleEvent as SharedSubagentLifecycleEvent,
  type SubagentStatus as SharedSubagentStatus,
} from "../../../src/shared/ipc";
import type {
  AskUserAnswerItem,
  AskUserItem,
  AskUserOption,
  AskUserResponse,
} from "@innocenceharness/plugin-ask";
import type { DiscoveredSkill } from "../../../src/main/skillDiscovery";
import type { McpImportResult, McpServerEntry } from "../../../src/main/mcpImport";
import type { PermissionResource } from "@innocenceharness/harness-permissions";
import type {
  SubagentLifecycleEvent as AgentSubagentLifecycleEvent,
  SubagentStatus as AgentSubagentStatus,
} from "@innocenceharness/harness-agent";
import type { ContextUsageSnapshot } from "@innocenceharness/harness-context-meter";
import type { ChatContextUsageSnapshot } from "../../../src/shared/ipc";
import {
  DEFAULT_SETTINGS,
  MOCK_MODEL as PKG_MOCK_MODEL,
  MOCK_PROFILE_ID as PKG_MOCK_PROFILE_ID,
  PROVIDER_PRESETS,
  type HarnessSettings as PackageHarnessSettings,
  type ProviderKind as PackageProviderKind,
} from "../src/settings";
import { PRESET_MODELS } from "../src/modelPresets";

describe("PROVIDER_PRESET_MIRROR 对齐 PROVIDER_PRESETS", () => {
  it("厂家集合一致（无缺漏、无多余）", () => {
    expect(PROVIDER_PRESET_MIRROR.map((p) => p.name)).toEqual(PROVIDER_PRESETS.map((p) => p.name));
  });
  it("每家 name/kind/baseURL/models 逐一相等", () => {
    expect(PROVIDER_PRESET_MIRROR).toEqual(PROVIDER_PRESETS);
  });
  it("native generative preset remains a separate protocol option", () => {
    expect(PROVIDER_PRESET_MIRROR.find((preset) => preset.name === "Native generative")).toMatchObject({ kind: "google" });
  });
});

describe("PRESET_MODELS 键对齐 PROVIDER_PRESETS", () => {
  it("元数据键 ⊆ 预设厂家名（键拼错 = enrich 永远 miss）", () => {
    const names = new Set(PROVIDER_PRESETS.map((p) => p.name));
    for (const key of Object.keys(PRESET_MODELS)) {
      expect(names.has(key), `PRESET_MODELS 键 "${key}" 不在任何预设厂家名里`).toBe(true);
    }
  });
  it("每家预设 seed 模型都有元数据（seed 无元数据 = 出厂裸模型）", () => {
    for (const preset of PROVIDER_PRESETS) {
      const meta = PRESET_MODELS[preset.name] ?? {};
      for (const id of preset.models) {
        expect(meta[id], `${preset.name} 的 seed 模型 "${id}" 缺元数据`).toBeDefined();
      }
    }
  });
});

describe("shared ProviderKind 镜像对齐 settings domain", () => {
  it("双方均保留 native kind", () => {
    const shared: SharedProviderKind = "google";
    const pkg: PackageProviderKind = shared;
    const back: SharedProviderKind = pkg;
    expect(back).toBe("google");
  });
});

describe("shared 与包内 mock 常量对齐", () => {
  it("MOCK_PROFILE_ID / MOCK_MODEL 一致", () => {
    expect(MOCK_PROFILE_ID).toBe(PKG_MOCK_PROFILE_ID);
    expect(MOCK_MODEL).toBe(PKG_MOCK_MODEL);
  });
});

describe("shared HarnessSettings.activeAgentMode 镜像对齐 harness-electron settings domain", () => {
  // shared 不 import 包，字段手工镜像：任一侧删除/改型（如收窄为封闭联合）
  // 而忘了同步另一侧时，Pick 约束与双向赋值都会让 typecheck 失败。
  it("类型漂移守卫：activeAgentMode 双向兼容（开放 string 集合）", () => {
    const shared: Pick<SharedHarnessSettings, "activeAgentMode"> = { activeAgentMode: "code-review" };
    const pkg: Pick<PackageHarnessSettings, "activeAgentMode"> = shared;
    const back: Pick<SharedHarnessSettings, "activeAgentMode"> = pkg;
    expect(back.activeAgentMode).toBe("code-review");
  });
  it("包侧出厂默认值为 default（回落语义见 settings.test.ts）", () => {
    expect(DEFAULT_SETTINGS.activeAgentMode).toBe("default");
  });
});

describe("shared DiscoveredSkillMirror 镜像对齐 main skillDiscovery", () => {
  // shared 不 import main，发现 DTO 手工镜像：main 增删字段或改语义而忘了
  // 同步 shared 时，双向赋值与字面量赋值会让 typecheck 失败。
  const sample: SharedDiscoveredSkill = {
    name: "review",
    description: "审查指南",
    sourceDir: "D:/home/.claude/skills/review",
    origin: "external-a",
    imported: false,
  };

  it("类型漂移守卫：shared 镜像与 main DiscoveredSkill 双向兼容", () => {
    const main: DiscoveredSkill = sample;
    const back: SharedDiscoveredSkill = main;
    expect(back).toEqual(sample);
  });
});

describe("shared MCP 导入 DTO 镜像对齐 main mcpImport", () => {
  // shared 不 import main，MCP 导入 DTO 手工镜像：main 增删字段而忘了同步
  // shared 时，双向赋值会让 typecheck 失败。
  const entry: McpServerEntryMirror = {
    command: "npx",
    args: ["-y", "server"],
    env: { K: "v" },
  };
  const result: McpImportResultMirror = {
    imported: ["a"],
    skipped: [
      { name: "b", reason: "duplicate" },
      { name: "invalid", reason: "invalid-entry" },
    ],
  };

  it("类型漂移守卫：entry 与 result 双向兼容", () => {
    const mainEntry: McpServerEntry = entry;
    const backEntry: McpServerEntryMirror = mainEntry;
    expect(backEntry).toEqual(entry);
    const mainResult: McpImportResult = result;
    const backResult: McpImportResultMirror = mainResult;
    expect(backResult).toEqual(result);
  });
});

describe("ChatPermissionEvent.resource 对齐 harness-permissions PermissionResource", () => {
  // host 桥只透传 kind/action/scope（metadata 为预留的可选面），
  // shared 不 import 包，靠双向赋值防漂移。
  const event: ChatPermissionEvent = {
    sessionId: "s1",
    messageId: "m1",
    requestId: "p1",
    toolName: "Write",
    args: { path: "src/a.ts" },
    resource: { kind: "file", action: "write", scope: "src/a.ts" },
  };

  it("持久化形状：kind/action/scope 直达", () => {
    expect(event.resource.kind).toBe("file");
    expect(event.resource.action).toBe("write");
    expect(event.resource.scope).toBe("src/a.ts");
  });

  it("类型漂移守卫：shared 镜像与 core PermissionResource 双向兼容", () => {
    const core: PermissionResource = event.resource;
    const mirror: ChatPermissionEvent["resource"] = core;
    expect(core).toEqual({ action: "write", kind: "file", scope: "src/a.ts" });
    expect(mirror.scope).toBe("src/a.ts");
  });
});

describe("shared ChatQuestion* 镜像对齐 plugin-ask AskUser*", () => {
  // shared 不 import 包，询问卡 DTO 手工镜像（plugin-ask askUser.ts 的
  // AskUser* 纯数据形状）：任一侧增删字段或改可选性而忘了同步另一侧时，
  // 双向赋值会让 typecheck 失败（漂移不再静默）。
  const option: ChatQuestionOption = { label: "PostgreSQL", description: "recommended" };
  const item: ChatQuestionItem = {
    question: "Which database?",
    header: "Database",
    options: [option],
    multiSelect: true,
  };
  const answer: ChatQuestionAnswerItem = { question: "Which database?", answers: ["PostgreSQL"] };

  it("类型漂移守卫：option/item/answer/response 双向兼容", () => {
    const pkgOption: AskUserOption = option;
    const backOption: ChatQuestionOption = pkgOption;
    expect(backOption).toEqual(option);
    const pkgItem: AskUserItem = item;
    const backItem: ChatQuestionItem = pkgItem;
    expect(backItem).toEqual(item);
    const pkgAnswer: AskUserAnswerItem = answer;
    const backAnswer: ChatQuestionAnswerItem = pkgAnswer;
    expect(backAnswer).toEqual(answer);
    const response: ChatQuestionResponse = { answers: [answer] };
    const pkgResponse: AskUserResponse = response;
    const backResponse: ChatQuestionResponse = pkgResponse;
    expect(backResponse).toEqual(response);
  });

  it("事件载荷直通：ChatQuestionEvent.questions 即插件问题形状", () => {
    const event: ChatQuestionEvent = {
      sessionId: "s1",
      messageId: "m1",
      requestId: "q1",
      toolName: "ask_user",
      questions: [item],
    };
    const questions: AskUserItem[] = event.questions;
    expect(questions[0]?.options[0]?.label).toBe("PostgreSQL");
  });

  it("应答守卫：answers 数组与 null 均合法，坏形状拒绝", () => {
    expect(isChatQuestionResponse(null)).toBe(true);
    expect(isChatQuestionResponse({ answers: [answer] })).toBe(true);
    expect(isChatQuestionResponse({ answers: [{ question: "q", answers: [] }] })).toBe(true);
    expect(isChatQuestionResponse({ answers: "nope" })).toBe(false);
    expect(isChatQuestionResponse({ answers: [{ question: "q", answers: [1] }] })).toBe(false);
  });
});

describe("shared SubagentLifecycleEvent 镜像对齐 harness-agent domain 事件", () => {
  // shared 不 import 包，事件 DTO 手工镜像（tool 载荷的 title/result 等）：
  // 任一侧增删字段或改可选性而忘了同步另一侧时，双向赋值与状态值枚举
  // 会让 typecheck 失败（漂移不再静默）。
  const sample: SharedSubagentLifecycleEvent = {
    childId: "c1",
    parentSessionId: "s1",
    description: "任务",
    status: "running",
    parentInvocationId: "inv-1",
    agentType: "explore",
    prompt: "去查",
    delta: "增量",
    thinkingDelta: "推理增量",
    tool: { name: "Grep", phase: "call", isError: false, title: "pattern", result: "out" },
    final: "报告",
    error: "失败",
  };

  it("类型漂移守卫：shared 镜像与包内事件双向兼容", () => {
    const domain: AgentSubagentLifecycleEvent = sample;
    const back: SharedSubagentLifecycleEvent = domain;
    expect(back.tool).toEqual({ name: "Grep", phase: "call", isError: false, title: "pattern", result: "out" });
  });

  it("状态值枚举双向对齐（两侧联合独立定义）", () => {
    const statuses: readonly SharedSubagentStatus[] = ["started", "running", "completed", "failed", "cancelled"];
    for (const status of statuses) {
      const domain: AgentSubagentStatus = status;
      const back: SharedSubagentStatus = domain;
      expect(back).toBe(status);
    }
  });
});

describe("shared ChatContextUsageSnapshot 镜像对齐 harness-context-meter", () => {
  // shared 不 import 包，计量快照手工镜像（contextWindow 为宿主富化扩展）：
  // 任一侧增删字段或改可选性而忘了同步另一侧时，双向赋值会让 typecheck
  // 失败（漂移不再静默）。
  it("context meter 镜像双向可赋值（漂移守卫）", () => {
    const sample: ContextUsageSnapshot = {
      inputTokens: 1,
      breakdown: { systemPrompt: 1, skills: 0, systemTools: 0, mcpTools: 0, messages: 0, other: 0 },
      cache: { inputTokens: 1, cachedInputTokens: 0 },
    };
    const mirrored: ChatContextUsageSnapshot = sample; // 包 → 镜像
    const back: ContextUsageSnapshot = mirrored; // 镜像 → 包
    void back;
    expect(mirrored.inputTokens).toBe(1);
  });
});
