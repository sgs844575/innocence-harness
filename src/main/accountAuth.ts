// 账号授权宿主面（交互式授权波）：令牌存储的懒装配 + MCP 服务器授权端口
// 的会话绑定。同意面复用 ask_user 的聊天问题卡基础设施（pendingQuestions
// 注册表 + 广播/应答/落定），浏览器打开走 shell.openExternal 注入端口。
// 本模块保持 Electron-free（组合根注入 openExternal），Node 可测。
import path from "node:path";
import { openSecureStorage } from "@innocenceharness/secure-storage-node";
import {
  createAccountAuthorizer,
  createAuthorizationStore,
  type AccountAuthorizer,
  type AuthorizationStore,
} from "@innocenceharness/harness-auth";
import { createAskUserPort, type AskUserPortDeps } from "./askUserPort";

/**
 * MCP 授权端口的产出结构 —— plugin-mcp McpAuthorizationOutcome 的宿主侧
 * 镜像（镜像契约：插件侧保持运行时所有者，宿主不静态依赖 staged 插件的
 * 类型面；两边同形修改）。
 */
export type McpAuthorizationOutcome =
  | { status: "authorized"; headers: Record<string, string> }
  | { status: "none" }
  | { status: "declined"; reason: string }
  | { status: "failed"; reason: string };

const CONSENT_OPEN_LABEL = "打开浏览器授权";
const CONSENT_SKIP_LABEL = "跳过";

/** 组合根注入的端口（全部可测替换）。 */
export interface AccountAuthServiceDeps extends AskUserPortDeps {
  /** 令牌存储根（~/.innocence/auth-tokens）。 */
  tokensRoot(): string;
  /** 打开外部浏览器（Electron shell.openExternal 的注入面）。 */
  openExternal(url: string): Promise<void>;
  /** fetch 注入面（默认全局 fetch）。 */
  fetchImpl?: AccountFetch;
  log?(level: "info" | "warn" | "error", message: string): void;
}

type AccountFetch = (url: string, init?: RequestInit) => Promise<Response>;

let storeCache: { root: string; store: AuthorizationStore } | undefined;

async function tokensStore(deps: AccountAuthServiceDeps): Promise<AuthorizationStore> {
  const root = deps.tokensRoot();
  storeCache ??= { root, store: createAuthorizationStore(await openSecureStorage(root, { dirs: [] })) };
  return storeCache.store;
}

/** 调试/测试：丢弃缓存的存储实例（目录换了根时重建）。 */
export function resetAccountAuthCache(): void {
  storeCache = undefined;
}

/**
 * 创建绑定到一次路由会话身份的 MCP 授权端口：同意卡经该会话的 ask
 * 队列串行浮出（与 ask_user 同一张卡面），授权成功后的 Bearer 头由
 * plugin-mcp 在连接前合并进请求头。返回结构化结果，不抛出。
 */
export function createMcpAuthorizationPort(
  deps: AccountAuthServiceDeps,
  identity: { sessionId: string; routeId: string },
): (server: { name: string; url: string }) => Promise<McpAuthorizationOutcome> {
  const ask = createAskUserPort(deps, identity);
  const authorizerPromise = (async (): Promise<AccountAuthorizer> =>
    createAccountAuthorizer({
      store: await tokensStore(deps),
      fetchImpl: deps.fetchImpl ?? ((url, init) => fetch(url, init)),
      openExternal: (url) => deps.openExternal(url),
      consent: async (server) => {
        const outcome = await ask([
          {
            question: `MCP 服务器 ${server.key} 需要账号授权。现在打开浏览器完成登录吗？`,
            header: "账号授权",
            options: [
              { label: CONSENT_OPEN_LABEL, description: `在默认浏览器中打开 ${new URL(server.url).host} 的授权页面` },
              { label: CONSENT_SKIP_LABEL, description: "本次跳过，该服务器的工具暂不可用" },
            ],
          },
        ]);
        if (outcome.status !== "answered") return false;
        return outcome.answers[0]?.answers.includes(CONSENT_OPEN_LABEL) ?? false;
      },
      ...(deps.log ? { log: deps.log } : {}),
    }))();
  return async (server) => {
    const authorizer = await authorizerPromise;
    return authorizer.authorize({ key: server.name, url: server.url });
  };
}

/** 授权令牌根（组合根解析：appDataRoot()/auth-tokens）。 */
export function accountTokensRoot(appRoot: string): string {
  return path.join(appRoot, "auth-tokens");
}
