// PKCE 授权码流程（RFC 7636）与令牌刷新：环回重定向接收器 + 授权 URL
// 构造 + code 兑换 + refresh_token 兑换。所有交互面（打开浏览器、HTTP）
// 均为注入端口；等待回调受 AbortSignal 控制，不设假超时。
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthFetch } from "./metadata";

/** PKCE 校验器（code_verifier）：43-128 字符的 base64url 串。 */
export function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** PKCE 挑战（code_challenge）：verifier 的 S256 摘要 base64url。 */
export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** 防回调伪造的 state 参数。 */
export function createState(): string {
  return randomBytes(24).toString("base64url");
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** epoch 毫秒；缺省表示不透明无过期信息。 */
  expiresAt?: number;
  scope?: string;
}

export interface TokenEndpointResult extends TokenSet {}

interface TokenResponseShape {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

/** POST 表单到令牌端点并校验响应形状（授权码与刷新共用）。 */
export async function postTokenRequest(
  tokenEndpoint: string,
  form: Record<string, string>,
  fetchImpl: AuthFetch,
): Promise<TokenEndpointResult> {
  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    redirect: "manual",
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new Error(`token endpoint returned HTTP ${response.status} with a non-JSON body`);
  }
  if (!response.ok) {
    const shape = parsed as { error?: unknown; error_description?: unknown };
    const detail = typeof shape.error_description === "string" ? `: ${shape.error_description}` : "";
    const code = typeof shape.error === "string" ? shape.error : `HTTP ${response.status}`;
    throw new Error(`token exchange failed (${code})${detail}`);
  }
  const shape = parsed as TokenResponseShape;
  if (typeof shape.access_token !== "string" || shape.access_token === "") {
    throw new Error("token response is missing access_token");
  }
  return {
    accessToken: shape.access_token,
    ...(typeof shape.refresh_token === "string" && shape.refresh_token !== ""
      ? { refreshToken: shape.refresh_token }
      : {}),
    ...(typeof shape.expires_in === "number" && Number.isFinite(shape.expires_in) && shape.expires_in > 0
      ? { expiresAt: Date.now() + shape.expires_in * 1000 }
      : {}),
    ...(typeof shape.scope === "string" && shape.scope !== "" ? { scope: shape.scope } : {}),
  };
}

/** 以 refresh_token 兑换新令牌；无 refresh 令牌时直接拒绝。 */
export async function refreshTokens(
  tokens: TokenSet,
  endpoints: { tokenEndpoint: string; clientId: string },
  fetchImpl: AuthFetch,
): Promise<TokenEndpointResult> {
  if (!tokens.refreshToken) throw new Error("no refresh token available");
  const result = await postTokenRequest(
    endpoints.tokenEndpoint,
    {
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: endpoints.clientId,
    },
    fetchImpl,
  );
  // 授权服务器可以不回发新 refresh_token（RFC 6749 6.）：旧值续用。
  return { ...result, refreshToken: result.refreshToken ?? tokens.refreshToken };
}

export interface LoopbackCallback {
  port: number;
  redirectUri: string;
  /** 停止监听并解决所有挂起的等待（失败落定）。 */
  close(): Promise<void>;
  /** 等待一次回调：code/err/state；signal 中止后立即以 AbortError 落定。 */
  waitForCallback(signal: AbortSignal): Promise<CallbackQuery>;
}

export interface CallbackQuery {
  code?: string;
  error?: string;
  errorDescription?: string;
  state?: string;
}

/**
 * 起一个 127.0.0.1 环回接收器（OAuth 授权码重定向的本地落地）。端口由
 * 系统分配（port 0），redirectUri 即授权服务器回跳地址。同一时间只服务
 * 一次等待；页面应答一个极简 HTML 后连接即关闭。
 */
export async function startLoopbackReceiver(host = "127.0.0.1", requestedPort = 0): Promise<LoopbackCallback> {
  const queries: CallbackQuery[] = [];
  const waiters: Array<(query: CallbackQuery) => void> = [];
  let settled = false;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    const query: CallbackQuery = {};
    for (const [key, value] of url.searchParams) {
      if (key === "code") query.code = value;
      else if (key === "error") query.error = value;
      else if (key === "error_description") query.errorDescription = value;
      else if (key === "state") query.state = value;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><meta charset=\"utf-8\"><body><script>window.close()</script></body>");
    if (!settled && waiters.length > 0) waiters.shift()!(query);
    else queries.push(query);
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(requestedPort, host, () => resolvePromise());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    redirectUri: `http://${host}:${port}/callback`,
    async close() {
      settled = true;
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    },
    waitForCallback(signal) {
      if (signal.aborted) return Promise.reject(new DOMException("authorization callback wait aborted", "AbortError"));
      const queued = queries.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise<CallbackQuery>((resolvePromise, rejectPromise) => {
        const waiter = (query: CallbackQuery): void => {
          cleanup();
          resolvePromise(query);
        };
        const onAbort = (): void => {
          cleanup();
          rejectPromise(new DOMException("authorization callback wait aborted", "AbortError"));
        };
        const cleanup = (): void => {
          signal.removeEventListener("abort", onAbort);
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
        };
        waiters.push(waiter);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

export interface AuthorizationCodeFlowInput {
  callbackPort?: number;
  /** 授权端点（来自授权服务器元数据或显式配置）。 */
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** 被授权的资源标识（RFC 8707 resource 参数，恒等于服务器 URL）。 */
  resource: string;
  clientId: string;
  scope?: string;
  fetchImpl: AuthFetch;
  /** 打开外部浏览器执行用户登录；缺省则流程无法进行（直接拒绝）。 */
  openExternal: (url: string) => Promise<void>;
  /** 控制回调等待的中止信号（也用于整体流程取消）。 */
  signal: AbortSignal;
}

/** 构造带 PKCE + state + resource 的授权 URL（导出供测试断言）。 */
export function buildAuthorizationUrl(input: {
  authorizationEndpoint: string;
  redirectUri: string;
  clientId: string;
  resource: string;
  scope?: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  const params = url.searchParams;
  params.set("response_type", "code");
  params.set("client_id", input.clientId);
  params.set("redirect_uri", input.redirectUri);
  params.set("state", input.state);
  params.set("code_challenge", input.codeChallenge);
  params.set("code_challenge_method", "S256");
  params.set("resource", input.resource);
  if (input.scope !== undefined && input.scope !== "") params.set("scope", input.scope);
  return url.toString();
}

/**
 * 完整授权码 + PKCE 流程：起环回接收器 → 构造授权 URL → 打开浏览器 →
 * 等待回调（state 校验）→ 兑换令牌。任何一步失败都先关闭接收器再抛出，
 * 不留监听句柄。用户在回调里带回 error（如 access_denied）时抛出对应
 * 语义的错误。
 */
export async function runAuthorizationCodeFlow(
  input: AuthorizationCodeFlowInput,
): Promise<TokenEndpointResult> {
  const receiver = await startLoopbackReceiver(input.callbackPort ? "localhost" : "127.0.0.1", input.callbackPort);
  try {
    const verifier = createCodeVerifier();
    const state = createState();
    const authorizeUrl = buildAuthorizationUrl({
      authorizationEndpoint: input.authorizationEndpoint,
      redirectUri: receiver.redirectUri,
      clientId: input.clientId,
      resource: input.resource,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      state,
      codeChallenge: codeChallengeS256(verifier),
    });
    await input.openExternal(authorizeUrl);
    const callback = await receiver.waitForCallback(input.signal);
    if (callback.state !== state) {
      throw new Error("authorization callback state mismatch; retry the authorization");
    }
    if (callback.error !== undefined) {
      throw new Error(
        `authorization was declined (${callback.error}` +
        `${callback.errorDescription !== undefined ? `: ${callback.errorDescription}` : ""})`,
      );
    }
    if (callback.code === undefined || callback.code === "") {
      throw new Error("authorization callback carried no authorization code");
    }
    return await postTokenRequest(
      input.tokenEndpoint,
      {
        grant_type: "authorization_code",
        code: callback.code,
        redirect_uri: receiver.redirectUri,
        client_id: input.clientId,
        code_verifier: verifier,
      },
      input.fetchImpl,
    );
  } finally {
    await receiver.close().catch(() => {});
  }
}
