// plugin-ask tests: the ask_user tool contract (shape, field-naming
// validation, limits, permission resource), the port outcome trio, the
// stop-signal race, the answer formatter cap, and the factory plugin
// mounting on a real kernel Context (including the permission allow rule
// when the permissions spine service is live; the distribution default
// export is the factory itself).
import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import type { PolicyRule } from "@innocenceharness/harness-permissions";
import {
  ASK_USER_ALLOW_RULE,
  ASK_USER_ANSWER_CAP,
  ASK_USER_SKIPPED_NOTE,
  ASK_USER_TOOL_NAME,
  ASK_USER_UNAVAILABLE_ERROR,
  createAskPlugin,
  createAskUserTool,
  formatAskUserAnswers,
  unavailableAskUserPort,
  validateQuestions,
  type AskUserItem,
  type AskUserOutcome,
  type AskUserPort,
} from "../src";
import askDefault from "../src";

const toolCtx = (signal?: AbortSignal) =>
  ({
    workspaceRoot: "D:/work",
    signal: signal ?? new AbortController().signal,
    log: () => {},
    scope: { sessionId: "s1", invocationId: "inv-1" },
  }) as never;

const sampleQuestions: AskUserItem[] = [
  {
    question: "Which database should the migration target?",
    header: "Database",
    options: [
      { label: "PostgreSQL (Recommended)", description: "Mature, best tooling" },
      { label: "SQLite", description: "Zero-ops embedded" },
    ],
  },
];

/** Fake port scripting one outcome per call (records the surfaced questions). */
function fakePort(outcome: () => Promise<AskUserOutcome>):
  AskUserPort & { calls: AskUserItem[][] } {
  const calls: AskUserItem[][] = [];
  const port: AskUserPort = async (questions) => {
    calls.push(questions);
    return outcome();
  };
  return Object.assign(port, { calls });
}

describe("ask_user tool shape", () => {
  const tool = createAskUserTool({ askUser: unavailableAskUserPort });

  it("name/readOnly/sideEffect/awaitsUser: a user-interaction read", () => {
    expect(tool.name).toBe(ASK_USER_TOOL_NAME);
    expect(ASK_USER_TOOL_NAME).toBe("ask_user");
    expect(tool.readOnly).toBe(true);
    expect(tool.sideEffect).toBe("none");
    // 等待用户作答不设会话工具截止（仓库纪律：等待用户不设墙钟超时）。
    expect(tool.awaitsUser).toBe(true);
  });

  it("parameters require questions; description follows the Chinese tool style", () => {
    expect(tool.parameters).toMatchObject({
      type: "object",
      required: ["questions"],
    });
    expect((tool.parameters as { properties: Record<string, unknown> }).properties.questions).toBeDefined();
    expect(tool.description).toMatch(/结构化问题/);
    expect(tool.description).toMatch(/真正属于用户/);
  });

  it("permission resource: constant user-ask identity", () => {
    expect(tool.permissionResource({ questions: sampleQuestions }, toolCtx())).toEqual({
      action: "ask",
      kind: "user",
      scope: "questions",
    });
  });
});

describe("ask_user validation", () => {
  it("accepts 1–4 questions with 1–4 unique-label options", () => {
    expect(validateQuestions(sampleQuestions)).toEqual(sampleQuestions);
    const four: AskUserItem[] = Array.from({ length: 4 }, (_, i) => ({
      question: `q${i}`,
      options: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }],
    }));
    expect(validateQuestions(four)).toHaveLength(4);
  });

  it("rejects bad shapes naming the failing field", () => {
    expect(() => validateQuestions(undefined)).toThrow(/questions/);
    expect(() => validateQuestions([])).toThrow(/questions/);
    expect(() => validateQuestions([{} as unknown as AskUserItem])).toThrow(/questions\[0\].question/);
    expect(() =>
      validateQuestions([{ question: "q", options: [] } as unknown as AskUserItem]),
    ).toThrow(/questions\[0\].options/);
    expect(() =>
      validateQuestions([
        { question: "q", options: Array.from({ length: 5 }, (_, i) => ({ label: `o${i}` })) },
      ]),
    ).toThrow(/最多/);
    expect(() =>
      validateQuestions([{ question: "q", options: [{ label: "a" }, { label: "a" }] }]),
    ).toThrow(/重复 label/);
    expect(() =>
      validateQuestions([{ question: "q", options: [{} as unknown as { label: string }], multiSelect: "yes" }]),
    ).toThrow(/options\[0\].label/);
  });

  it("caps questions at four", () => {
    const five = Array.from({ length: 5 }, () => sampleQuestions[0]!);
    expect(() => validateQuestions(five)).toThrow(/最多 4 题/);
  });

  it("rejects over-long model-authored text (IPC/transcript stay bounded)", () => {
    expect(() =>
      validateQuestions([{ ...sampleQuestions[0]!, question: "q".repeat(2_001) }]),
    ).toThrow(/question 超长/);
    expect(() =>
      validateQuestions([{ ...sampleQuestions[0]!, header: "h".repeat(61) }]),
    ).toThrow(/header 超长/);
    expect(() =>
      validateQuestions([{ ...sampleQuestions[0]!, options: [{ label: "l".repeat(201) }] }]),
    ).toThrow(/label 超长/);
    expect(() =>
      validateQuestions([{ ...sampleQuestions[0]!, options: [{ label: "ok", description: "d".repeat(501) }] }]),
    ).toThrow(/description 超长/);
  });
});

describe("ask_user execution through the injected port", () => {
  it("answered: returns the formatted answers block", async () => {
    const port = fakePort(async () => ({
      status: "answered",
      answers: [{ question: "Which database?", answers: ["PostgreSQL (Recommended)"] }],
    }));
    const tool = createAskUserTool({ askUser: port });
    const result = await tool.execute({ questions: sampleQuestions }, toolCtx());
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe("Q: Which database?\nA: PostgreSQL (Recommended)");
    expect(port.calls).toEqual([sampleQuestions]);
  });

  it("skipped: returns the dismissal note as a normal result", async () => {
    const tool = createAskUserTool({ askUser: fakePort(async () => ({ status: "skipped" })) });
    const result = await tool.execute({ questions: sampleQuestions }, toolCtx());
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe(ASK_USER_SKIPPED_NOTE);
  });

  it("unavailable: isError with the no-surface error", async () => {
    const tool = createAskUserTool({ askUser: unavailableAskUserPort });
    const result = await tool.execute({ questions: sampleQuestions }, toolCtx());
    expect(result.isError).toBe(true);
    expect(result.content).toBe(ASK_USER_UNAVAILABLE_ERROR);
  });

  it("execute self-guards args (validateArgs narrowing never crosses the boundary)", async () => {
    const port = fakePort(async () => ({ status: "skipped" }));
    const tool = createAskUserTool({ askUser: port });
    const bad = await tool.execute({ questions: "nope" }, toolCtx());
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/questions/);
    expect(port.calls).toHaveLength(0);
  });

  it("run-signal abort rejects the pending ask with an abort-shaped error", async () => {
    const controller = new AbortController();
    const port = fakePort(() => new Promise<AskUserOutcome>(() => undefined));
    const tool = createAskUserTool({ askUser: port });
    const pending = tool.execute({ questions: sampleQuestions }, toolCtx(controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("answer formatting", () => {
  it("multi-select answers join with a comma; questions separate with a blank line", () => {
    expect(
      formatAskUserAnswers([
        { question: "q1", answers: ["a", "b"] },
        { question: "q2", answers: ["c"] },
      ]),
    ).toBe("Q: q1\nA: a, b\n\nQ: q2\nA: c");
  });

  it("over-long blocks are capped with a truncation note", () => {
    const block = formatAskUserAnswers([
      { question: "q", answers: ["x".repeat(ASK_USER_ANSWER_CAP + 500)] },
    ]);
    expect(block.length).toBeLessThanOrEqual(ASK_USER_ANSWER_CAP + 200);
    expect(block).toMatch(/truncated/i);
  });
});

describe("ask plugin factory", () => {
  it("registers ask_user on a real kernel Context through the persistence gate", async () => {
    const port = fakePort(async () => ({ status: "skipped" }));
    const plugin = createAskPlugin({ askUser: port });
    expect(plugin.name).toBe("ask");
    const ctx = new Context();
    await ctx.plugin(ToolsPlugin);
    await ctx.plugin(plugin);
    const registered = ctx.tools.get(ASK_USER_TOOL_NAME);
    expect(registered?.name).toBe("ask_user");
    expect(registered?.readOnly).toBe(true);
    const result = await registered!.execute({ questions: sampleQuestions }, toolCtx());
    expect(result.content).toBe(ASK_USER_SKIPPED_NOTE);
  });

  it("registers the permission allow rule when the permissions service is live", async () => {
    const registered: string[] = [];
    const ctx = new Context();
    await ctx.plugin(ToolsPlugin);
    ctx.provide("permissions", {
      engine: {},
      approvePlan: () => {},
      registerPolicyRule: (rule: PolicyRule) => registered.push(rule.name),
      policyRules: () => [],
    } as never);
    await ctx.plugin(createAskPlugin({ askUser: unavailableAskUserPort }));
    expect(registered).toEqual([ASK_USER_ALLOW_RULE.name]);
    expect(ASK_USER_ALLOW_RULE.match({ toolName: "ask_user", args: {} })).toBe("allow");
    expect(ASK_USER_ALLOW_RULE.match({ toolName: "Write", args: {} })).toBe("skip");
  });

  it("mounts without the permissions service (bare kernel composition)", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolsPlugin);
    await expect(
      ctx.plugin(createAskPlugin({ askUser: unavailableAskUserPort })),
    ).resolves.toBeDefined();
    expect(ctx.tools.get(ASK_USER_TOOL_NAME)?.name).toBe("ask_user");
  });

  it("distribution default export is the factory itself", () => {
    expect(askDefault).toBe(createAskPlugin);
  });
});
