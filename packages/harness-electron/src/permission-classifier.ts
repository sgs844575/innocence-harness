import type { ProviderModel } from "@innocenceharness/harness-providers";
import {
  createPermissionVerdictService,
  createStructuredOutputPort,
  type PermissionVerdictService,
} from "@innocenceharness/harness-ai-runtime";
import type {
  PermissionClassification,
  PermissionClassificationInput,
  PermissionClassifier,
} from "@innocenceharness/harness-permissions";

/** 单次评估硬超时：到点中止并回落用户询问（fail-closed）。 */
const DEFAULT_TIMEOUT_MS = 20_000;
/** 请求签名缓存上限（FIFO 淘汰）：同一持久化请求不重复花钱。 */
const CACHE_LIMIT = 128;

export interface PermissionClassifierOptions {
  /** 会话模型（惰性 getter 仿 automation candidateModel 先例）。 */
  model: ProviderModel | (() => Promise<ProviderModel>);
  /** 测试缝：缺省用结构化输出端口构建判定服务。 */
  verdictService?: PermissionVerdictService;
  timeoutMs?: number;
  log?(level: "info" | "warn" | "error", msg: string, data?: unknown): void;
}

/** 键序稳定的 JSON：参数键插入顺序不影响签名。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signatureOf(input: PermissionClassificationInput): string {
  const { toolName, resource } = input.request;
  return [
    toolName,
    resource.action,
    resource.kind,
    resource.scope,
    stableStringify(input.request.args),
  ].join("\u0000");
}

/**
 * Host adapter (S3): one ask-boundary classifier over the verdict service —
 * bounded timeout, bounded request-signature cache, and a fail-closed
 * contract (every failure resolves to undefined so the engine escalates to
 * the human ask).
 */
export function createPermissionClassifier(options: PermissionClassifierOptions): PermissionClassifier {
  const verdict = options.verdictService ?? createPermissionVerdictService(createStructuredOutputPort());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cache = new Map<string, PermissionClassification>();
  const remember = (key: string, value: PermissionClassification): void => {
    cache.set(key, value);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };
  return {
    async classify(input) {
      const key = signatureOf(input);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      // 超时由适配器强制：判定服务可能不消费 AbortSignal（如测试替身），
      // race 保证到点必回落（fail-closed），abort 供真实端口尽早取消。
      // 模型惰性解析（首问可能触发 staging 内核装载）也纳入竞态，且 timedOut
      // 在 race 处即刻挂上处理器，不会产生未处理拒绝。
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("permission classifier timed out"));
        }, timeoutMs);
      });
      try {
        const modelReady =
          typeof options.model === "function" ? options.model() : Promise.resolve(options.model);
        const result = await Promise.race([
          modelReady.then((model) =>
            verdict.classify({
              model,
              subject: {
                toolName: input.request.toolName,
                resource: { ...input.request.resource },
                args: input.request.args,
                readOnly: input.tool.readOnly,
                sideEffect: input.tool.sideEffect,
                recentDenials: input.recentDenials.map((note) => ({
                  toolName: note.toolName,
                  resource: { ...note.resource },
                  via: note.via,
                  reason: note.reason,
                })),
              },
              signal: controller.signal,
            }),
          ),
          timedOut,
        ]);
        const classification: PermissionClassification = {
          decision: result.verdict.decision,
          reason: result.verdict.reason,
        };
        remember(key, classification);
        return classification;
      } catch (error) {
        options.log?.(
          "warn",
          "permission classifier unavailable; escalating to user",
          { error: error instanceof Error ? error.name : String(error) },
        );
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
