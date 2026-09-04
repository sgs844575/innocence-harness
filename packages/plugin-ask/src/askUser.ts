// ask_user (structured questions): the agent surfaces one to four questions,
// each with up to four options, execution pauses until the user answers on the
// question card, and the selection returns as the tool result. Factory form:
// the ask port is host-injected (the plugin owns no UI or IPC knowledge), so
// tests pass fakes and the host composition binds the renderer bridge.
// Discipline: the AskUser* data shapes are a MIRROR CONTRACT with
// src/shared/ipc.ts ChatQuestion* (shared never imports packages) — modify
// both sides together (packages/harness-electron/tests/mirror.test.ts guards
// drift). Persisted args carry the questions verbatim so replay and the
// question card render the same content; errors name the failing field only.
import type { PolicyRule } from "@innocenceharness/harness-permissions";
import type { Tool } from "@innocenceharness/harness-tools";

export const ASK_USER_TOOL_NAME = "ask_user";

/** One selectable option (mirror of ChatQuestionOption). */
export interface AskUserOption {
  label: string;
  description?: string;
}

/** One question (mirror of ChatQuestionItem). 1–4 per call, 1–4 options each. */
export interface AskUserItem {
  question: string;
  header?: string;
  options: AskUserOption[];
  multiSelect?: boolean;
}

/** One answered question (mirror of ChatQuestionAnswerItem): selected labels. */
export interface AskUserAnswerItem {
  question: string;
  answers: string[];
}

/** Renderer-level response shape (mirror of ChatQuestionResponse):
 *  null = the user skipped the card, or the session was stopped. */
export type AskUserResponse = { answers: AskUserAnswerItem[] } | null;

/**
 * How one ask round settled. The host maps its renderer response onto this:
 * answers -> "answered", null -> "skipped"; a composition without a question
 * surface mounts the {@link unavailableAskUserPort} fallback instead.
 */
export type AskUserOutcome =
  | { status: "answered"; answers: AskUserAnswerItem[] }
  | { status: "skipped" }
  | { status: "unavailable"; error: string };

/**
 * Host-injected ask port: surfaces the questions to the user of THIS route
 * session and resolves with their settlement. The plugin treats it as opaque;
 * the port must honor the tool-context signal by resolving "skipped" (the
 * real bridge resolves through its own stop/cancel registry as well).
 */
export type AskUserPort = (questions: AskUserItem[]) => Promise<AskUserOutcome>;

/** Port used when the host composition provides no question surface. */
export const unavailableAskUserPort: AskUserPort = async () => ({
  status: "unavailable",
  error: ASK_USER_UNAVAILABLE_ERROR,
});

/** Error text for compositions without a question surface. */
export const ASK_USER_UNAVAILABLE_ERROR =
  "No interactive question surface is available in this session; ask questions in plain text instead.";

/** Result text when the user dismisses the card without answering. */
export const ASK_USER_SKIPPED_NOTE =
  "[The user dismissed the question card without answering. Proceed with your best judgment, or ask again in plain text.]";

/** Character cap for the whole answers block (keeps history bounded). */
export const ASK_USER_ANSWER_CAP = 8_000;

/** Truncation note appended when the answers block exceeds the cap. */
export const ASK_USER_ANSWER_TRUNCATED_NOTE =
  "[The user answers were truncated at 8000 characters.]";

/** Hard limits mirrored from the question-card contract (1–4 questions/options). */
export const ASK_USER_MAX_QUESTIONS = 4;
export const ASK_USER_MAX_OPTIONS = 4;

/** Text length caps: questions/options flow verbatim into IPC events, the
 *  persisted transcript and timeline rows — model-authored text stays bounded
 *  (symmetric with the answers cap). */
export const ASK_USER_QUESTION_MAX_CHARS = 2_000;
export const ASK_USER_HEADER_MAX_CHARS = 60;
export const ASK_USER_LABEL_MAX_CHARS = 200;
export const ASK_USER_DESCRIPTION_MAX_CHARS = 500;

/**
 * Session-level allow rule registered by the plugin itself: the question card
 * IS the user-consent surface, so gating ask_user behind a permission card
 * would double-prompt (an "allow ask_user?" card before every question card).
 * Deny rules still win — the engine's pipeline runs denyRule before allowRule,
 * so a project that explicitly denies asking keeps that intent.
 */
export const ASK_USER_ALLOW_RULE: PolicyRule = {
  name: "allow:ask_user",
  match: (call) => (call.toolName === ASK_USER_TOOL_NAME ? "allow" : "skip"),
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Structural validation shared by validateArgs and execute (execute must
 * self-guard: validateArgs narrowing does not cross the signature boundary).
 * Throws an error naming the failing field.
 */
export function validateQuestions(value: unknown): AskUserItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("questions 必须为非空数组（1–4 题）");
  }
  if (value.length > ASK_USER_MAX_QUESTIONS) {
    throw new Error(`questions 最多 ${ASK_USER_MAX_QUESTIONS} 题`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`questions[${index}] 必须为对象`);
    }
    const raw = item as Record<string, unknown>;
    if (!isNonEmptyString(raw.question)) {
      throw new Error(`questions[${index}].question 必须为非空字符串`);
    }
    if (raw.question.length > ASK_USER_QUESTION_MAX_CHARS) {
      throw new Error(`questions[${index}].question 超长（上限 ${ASK_USER_QUESTION_MAX_CHARS} 字符）`);
    }
    if (raw.header !== undefined && (typeof raw.header !== "string" || raw.header.trim().length === 0)) {
      throw new Error(`questions[${index}].header 必须为非空字符串`);
    }
    if ((raw.header ?? "").length > ASK_USER_HEADER_MAX_CHARS) {
      throw new Error(`questions[${index}].header 超长（上限 ${ASK_USER_HEADER_MAX_CHARS} 字符）`);
    }
    if (!Array.isArray(raw.options) || raw.options.length === 0) {
      throw new Error(`questions[${index}].options 必须为非空数组（1–4 个）`);
    }
    if (raw.options.length > ASK_USER_MAX_OPTIONS) {
      throw new Error(`questions[${index}].options 最多 ${ASK_USER_MAX_OPTIONS} 个`);
    }
    const labels = new Set<string>();
    const options = raw.options.map((option, optionIndex) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        throw new Error(`questions[${index}].options[${optionIndex}] 必须为对象`);
      }
      const rawOption = option as Record<string, unknown>;
      if (!isNonEmptyString(rawOption.label)) {
        throw new Error(`questions[${index}].options[${optionIndex}].label 必须为非空字符串`);
      }
      if (rawOption.label.length > ASK_USER_LABEL_MAX_CHARS) {
        throw new Error(`questions[${index}].options[${optionIndex}].label 超长（上限 ${ASK_USER_LABEL_MAX_CHARS} 字符）`);
      }
      if (
        rawOption.description !== undefined &&
        (typeof rawOption.description !== "string" || rawOption.description.trim().length === 0)
      ) {
        throw new Error(`questions[${index}].options[${optionIndex}].description 必须为非空字符串`);
      }
      if ((rawOption.description ?? "").length > ASK_USER_DESCRIPTION_MAX_CHARS) {
        throw new Error(`questions[${index}].options[${optionIndex}].description 超长（上限 ${ASK_USER_DESCRIPTION_MAX_CHARS} 字符）`);
      }
      if (labels.has(rawOption.label)) {
        throw new Error(`questions[${index}].options 存在重复 label（作答按 label 回传，必须唯一）`);
      }
      labels.add(rawOption.label);
      return {
        label: rawOption.label,
        ...(rawOption.description !== undefined ? { description: rawOption.description } : {}),
      };
    });
    if (raw.multiSelect !== undefined && typeof raw.multiSelect !== "boolean") {
      throw new Error(`questions[${index}].multiSelect 必须为布尔值`);
    }
    return {
      question: raw.question,
      ...(raw.header !== undefined ? { header: raw.header } : {}),
      options,
      ...(raw.multiSelect !== undefined ? { multiSelect: raw.multiSelect } : {}),
    };
  });
}

/** Formats the answers as the LLM-facing tool result (English framing). */
export function formatAskUserAnswers(answers: AskUserAnswerItem[]): string {
  const block = answers
    .map((item) => `Q: ${item.question}\nA: ${item.answers.join(", ")}`)
    .join("\n\n");
  if (block.length === 0) return ASK_USER_SKIPPED_NOTE;
  return block.length > ASK_USER_ANSWER_CAP
    ? `${block.slice(0, ASK_USER_ANSWER_CAP)}\n\n${ASK_USER_ANSWER_TRUNCATED_NOTE}`
    : block;
}

/** Rejects when the run signal aborts (the executor classifies it "aborted"). */
function signalAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => {
      const err = new Error("运行已中止（询问被取消）");
      err.name = "AbortError";
      reject(err);
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

export interface AskUserToolOptions {
  askUser: AskUserPort;
}

/** Creates the ask_user tool bound to the injected ask port. */
export function createAskUserTool(options: AskUserToolOptions): Tool {
  return {
    name: ASK_USER_TOOL_NAME,
    description:
      "向用户提出结构化问题并等待其在询问卡上作答（1–4 题、每题 1–4 个选项；multiSelect 一题可多选）。" +
      "仅用于真正属于用户的决断：请求、代码或惯例默认都定不下来的选择。" +
      "有惯例默认或代码里有答案时不要提问——自行采用并顺带说明即可。" +
      "作答以工具结果返回（选项 label）；用户跳过卡片时按最佳判断继续。问题与选项应自包含、可独立理解。",
    readOnly: true,
    sideEffect: "none",
    // 等待用户作答没有合理墙钟上限（仓库纪律：等待用户/子代理结果不设
    // 超时）——会话工具截止对本工具豁免，只有运行停止信号能终止等待。
    awaitsUser: true,
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "问题列表（1–4 题）",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "完整问题文本（自包含）" },
              header: { type: "string", description: "问题的短标签（可选，如“库选择”）" },
              options: {
                type: "array",
                description: "选项（1–4 个；推荐项放首位）",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "选项文案（作答按 label 回传，题内唯一）" },
                    description: { type: "string", description: "选项补充说明（可选）" },
                  },
                  required: ["label"],
                },
              },
              multiSelect: { type: "boolean", description: "该题可多选（可选，默认单选）" },
            },
            required: ["question", "options"],
          },
        },
      },
      required: ["questions"],
    },
    validateArgs(args) {
      validateQuestions(args.questions);
    },
    permissionResource() {
      // 用户交互资源：动作/类别恒定，作用域为问题集合的稳定标识。
      return { action: "ask", kind: "user", scope: "questions" };
    },
    async execute(args, ctx) {
      let questions: AskUserItem[];
      try {
        questions = validateQuestions(args.questions);
      } catch (err) {
        return { content: err instanceof Error ? err.message : String(err), isError: true };
      }
      let outcome: AskUserOutcome;
      try {
        outcome = await Promise.race([
          options.askUser(questions),
          signalAbort(ctx.signal),
        ]);
      } catch (err) {
        // 停止/中止：抛出交由执行器归类（parentAborted → outcome "aborted"）。
        throw err;
      }
      if (outcome.status === "unavailable") {
        return { content: outcome.error, isError: true };
      }
      if (outcome.status === "skipped") {
        return { content: ASK_USER_SKIPPED_NOTE };
      }
      return { content: formatAskUserAnswers(outcome.answers) };
    },
  };
}
