// 账号授权编排器：一个授权目标（serverKey + 服务器 URL）的完整生命周期
// ——已存令牌直用 → 临近过期刷新 → 401 元数据发现 → 同意卡 → 浏览器
// PKCE 流程 → 令牌落盘 → Bearer 头返回。面向 plugin-mcp 的 HTTP 服务器
// 授权（MCP 规范的受保护资源语义），全部交互面（fetch、打开浏览器、
// 同意询问）为注入端口，宿主把同意卡接到聊天问题卡。
export * from "./metadata";
export * from "./flow";
export * from "./store";
export * from "./config";
import { parseServerAuthorizationConfig, type ServerAuthorizationConfig } from "./config";

import {
  loadAuthorizationServerMetadata,
  loadAuthorizationServerMetadataUrl,
  loadResourceMetadata,
  parseWwwAuthenticate,
  type AuthFetch,
  type AuthorizationServerMetadata,
} from "./metadata";
import { refreshTokens, runAuthorizationCodeFlow, type TokenSet } from "./flow";
import { needsRefresh, type AuthorizationStore, type StoredAuthorization } from "./store";

/** 同意端口：向用户确认是否现在打开浏览器完成授权；false = 本次跳过。 */
export type ConsentPort = (server: { key: string; url: string }) => Promise<boolean>;

/** 授权尝试的结果：可直接使用的请求头，或带原因的失败。 */
export type AuthorizationOutcome =
  | { status: "authorized"; headers: Record<string, string> }
  | { status: "none" }
  | { status: "declined"; reason: string }
  | { status: "failed"; reason: string };

export interface AccountAuthorizerOptions {
  store: AuthorizationStore;
  fetchImpl: AuthFetch;
  openExternal: (url: string) => Promise<void>;
  /** 同意端口；缺省 = 无交互面，永不发起浏览器流程。 */
  consent?: ConsentPort;
  /** 显式端点覆盖（测试与不支持元数据发现的服务器）；恒优先于发现链。 */
  endpoints?: (server: { key: string; url: string }) =>
    | { authorizationEndpoint: string; tokenEndpoint: string }
    | undefined;
  clientId?: string;
  callbackPort?: number;
  authServerMetadataUrl?: string;
  scopes?: string[];
  /** 控制一次授权尝试的取消；缺省 = 不设上限（等用户或流程自然结束）。 */
  signal?: AbortSignal;
  log?: (level: "info" | "warn" | "error", message: string) => void;
}

const DEFAULT_CLIENT_ID = "InnocenceHarness";

/** 提前探测：带已存令牌 GET 服务器根，401 + WWW-Authenticate 视为需要授权。 */
async function probeResource(
  url: string,
  headers: Record<string, string>,
  fetchImpl: AuthFetch,
): Promise<{ unauthorized: false } | { unauthorized: true; realm?: string }> {
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json", ...headers }, redirect: "manual" });
    if (response.status !== 401) return { unauthorized: false };
    return { unauthorized: true, realm: parseWwwAuthenticate(response.headers.get("www-authenticate"))?.realm };
  } catch {
    // 探测本身失败不阻断：让后续正常连接报告真实网络错误。
    return { unauthorized: false };
  }
}

async function resolveEndpoints(
  server: { key: string; url: string },
  realm: string | undefined,
  options: AccountAuthorizerOptions,
): Promise<{ authorizationEndpoint: string; tokenEndpoint: string; scope?: string }> {
  const explicit = options.endpoints?.(server);
  if (explicit) return explicit;
  if (options.authServerMetadataUrl) return loadAuthorizationServerMetadataUrl(options.authServerMetadataUrl, options.fetchImpl);
  if (realm === undefined) {
    throw new Error("server requires authorization but exposes no discoverable metadata");
  }
  const resource = await loadResourceMetadata(realm, options.fetchImpl);
  const issuer = resource.authorizationServers[0]!;
  let metadata: AuthorizationServerMetadata;
  try {
    metadata = await loadAuthorizationServerMetadata(issuer, options.fetchImpl);
  } catch {
    // RFC 8414 发现失败时回落到把 authorization_servers 条目当签发者根
    // 直接拼 well-known（部分实现把完整元数据放在资源文档同级）。
    metadata = await loadAuthorizationServerMetadata(new URL(issuer).origin, options.fetchImpl);
  }
  return { ...metadata, ...(resource.scopesSupported ? { scope: resource.scopesSupported.join(" ") } : {}) };
}

function toHeaders(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

export interface AccountAuthorizer {
  /**
   * 一次完整授权尝试：已存令牌可用即直用（需要时先刷新）；无令牌/令牌
   * 失效且服务器确实要求授权时，经同意端口发起浏览器 PKCE 流程并落盘。
   * 任何失败都以 failed/declined 结果返回，不抛出（取消除外）。
   */
  authorize(server: { key: string; url: string; oauth?: ServerAuthorizationConfig }): Promise<AuthorizationOutcome>;
  /** 撤销一个目标的已存令牌。 */
  revoke(serverKey: string): Promise<void>;
}

export function createAccountAuthorizer(options: AccountAuthorizerOptions): AccountAuthorizer {
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const log = options.log ?? (() => {});

  const refreshStored = async (server: { key: string; url: string }): Promise<StoredAuthorization | undefined> => {
    const stored = await options.store.read(server.key);
    if (!stored || stored.profile.resource !== server.url || stored.profile.clientId !== clientId) return undefined;
    if (options.scopes && stored.profile.scope !== options.scopes.join(" ")) return undefined;
    if (!needsRefresh(stored)) return stored;
    if (!stored.refreshToken) return stored;
    try {
      const refreshed = await refreshTokens(
        stored,
        { tokenEndpoint: stored.profile.tokenEndpoint, clientId: stored.profile.clientId },
        options.fetchImpl,
      );
      const next: StoredAuthorization = { ...stored, ...refreshed };
      await options.store.write(server.key, next);
      return next;
    } catch (error) {
      // 刷新失败不抹掉旧令牌（可能是临时网络问题）；交由探测判定真伪。
      log("warn", `token refresh failed for ${server.key}: ${error instanceof Error ? error.message : String(error)}`);
      return stored;
    }
  };

  return {
    async authorize(server) {
      try {
        if (server.oauth) {
          const config = parseServerAuthorizationConfig(server.oauth);
          return await createAccountAuthorizer({ ...options, ...config }).authorize({ key: server.key, url: server.url });
        }
        const stored = await refreshStored(server);
        if (stored) {
          const probe = await probeResource(server.url, toHeaders(stored.accessToken), options.fetchImpl);
          if (!probe.unauthorized) return { status: "authorized", headers: toHeaders(stored.accessToken) };
        }
        // 无可用令牌或令牌被判失效：确认服务器确实要求授权（避免对无
        // 保护端点发起无意义浏览器流程）。
        const anonymous = await probeResource(server.url, {}, options.fetchImpl);
        if (!anonymous.unauthorized) return { status: "none" };
        if (options.consent === undefined) {
          return { status: "declined", reason: "no interactive consent surface available" };
        }
        const granted = await options.consent(server);
        if (!granted) return { status: "declined", reason: "user declined authorization" };
        const endpoints = await resolveEndpoints(server, anonymous.realm, options);
        if (options.scopes) endpoints.scope = options.scopes.join(" ");
        const tokens: TokenSet = await runAuthorizationCodeFlow({
          authorizationEndpoint: endpoints.authorizationEndpoint,
          tokenEndpoint: endpoints.tokenEndpoint,
          resource: server.url,
          clientId,
          callbackPort: options.callbackPort,
          ...(endpoints.scope !== undefined ? { scope: endpoints.scope } : {}),
          fetchImpl: options.fetchImpl,
          openExternal: options.openExternal,
          signal: options.signal ?? new AbortController().signal,
        });
        await options.store.write(server.key, {
          ...tokens,
          profile: {
            tokenEndpoint: endpoints.tokenEndpoint,
            clientId,
            resource: server.url,
            ...(endpoints.scope !== undefined ? { scope: endpoints.scope } : {}),
          },
          storedAt: Date.now(),
        });
        return { status: "authorized", headers: toHeaders(tokens.accessToken) };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        const reason = error instanceof Error ? error.message : String(error);
        log("warn", `authorization failed for ${server.key}: ${reason}`);
        return { status: "failed", reason };
      }
    },
    revoke(serverKey) {
      return options.store.delete(serverKey);
    },
  };
}
