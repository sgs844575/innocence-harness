import { EnvHttpProxyAgent, fetch as dispatcherFetch, type Dispatcher } from "undici";

/** fetch 加工面：协议栈可选项里的 `fetch`，不设置则走协议栈默认传输。 */
export interface ModelFetchResolution {
  fetch?: typeof fetch;
}

export interface ModelFetchOptions {
  /** 显式注入的 fetch（测试夹具、宿主自定义传输）；设置时其余选项失效。 */
  fetchImpl?: typeof fetch;
  /** 环境变量面（缺省 process.env）；仅测试注入。 */
  env?: NodeJS.ProcessEnv;
  /** 代理调度器工厂（缺省构造环境感知代理调度器）；仅测试注入。 */
  agentFactory?: () => Dispatcher;
}

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "all_proxy",
  "ALL_PROXY",
] as const;

const NO_PROXY_KEYS = ["NO_PROXY", "no_proxy"] as const;

function proxyConfigured(env: NodeJS.ProcessEnv): boolean {
  return PROXY_ENV_KEYS.some((key) => (env[key] ?? "").trim().length > 0);
}

/** 参与代理路由决策的环境变量快照（配置变化才重建调度器）。 */
function envFingerprint(env: NodeJS.ProcessEnv): string {
  return [...PROXY_ENV_KEYS, ...NO_PROXY_KEYS].map((key) => `${key}=${env[key] ?? ""}`).join("|");
}

let memo: { fingerprint: string; agent: Dispatcher } | undefined;

/** Test seam: forget the memoized proxy dispatcher (per-env rebuild). */
export function resetModelProxyDispatcher(): void {
  memo = undefined;
}

function dispatcherFor(env: NodeJS.ProcessEnv, agentFactory: () => Dispatcher): Dispatcher {
  const fingerprint = envFingerprint(env);
  if (!memo || memo.fingerprint !== fingerprint) {
    memo = { fingerprint, agent: agentFactory() };
  }
  return memo.agent;
}

/**
 * Model-request transport selection: an explicitly injected fetch always
 * wins; otherwise, when the process environment declares proxy settings,
 * requests flow through an env-aware proxy dispatcher (NO_PROXY honored by
 * the dispatcher itself). Without proxy settings nothing is attached, so the
 * no-proxy path keeps the runtime's default transport unchanged. The proxy
 * dispatcher is memoized per environment fingerprint for the process
 * lifetime — one dispatcher serves every model created in the process.
 */
export function resolveModelFetch(options: ModelFetchOptions = {}): ModelFetchResolution {
  if (options.fetchImpl) return { fetch: options.fetchImpl };
  const env = options.env ?? process.env;
  if (!proxyConfigured(env)) return {};
  const agent = dispatcherFor(env, options.agentFactory ?? (() => new EnvHttpProxyAgent()));
  const proxied = ((input: Parameters<typeof dispatcherFetch>[0], init?: Parameters<typeof dispatcherFetch>[1]) =>
    dispatcherFetch(input, { ...init, dispatcher: agent })) as unknown as typeof fetch;
  return { fetch: proxied };
}
