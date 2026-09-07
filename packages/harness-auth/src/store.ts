// 账号令牌持久化：每个授权目标（serverKey）一个 JSON 信封，落在
// secure-storage-node 的 ACL 加固根下（tokens/<key>.json，原子写）。
// 信封含颁发面（端点/客户端/资源），刷新时无需重新发现元数据。
import { createHash } from "node:crypto";
import type { SecureStorage } from "@innocenceharness/secure-storage-node";
import type { TokenSet } from "./flow";

/** 刷新所需的颁发面快照（授权完成时冻结进信封）。 */
export interface GrantProfile {
  tokenEndpoint: string;
  clientId: string;
  resource: string;
  scope?: string;
}

export interface StoredAuthorization extends TokenSet {
  profile: GrantProfile;
  storedAt: number;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * serverKey 归一：合法段原样使用；含分隔符/Unicode 的名字（如 bundle
 * 命名空间串）折叠为 sha256 前 24 hex，避免目录结构被 key 内容塑造。
 */
export function tokenFileKey(serverKey: string): string {
  const trimmed = serverKey.trim();
  if (KEY_PATTERN.test(trimmed)) return trimmed;
  return `k-${createHash("sha256").update(trimmed).digest("hex").slice(0, 24)}`;
}

/** 令牌存储端口（宿主可换内存实现测试）。 */
export interface AuthorizationStore {
  read(serverKey: string): Promise<StoredAuthorization | undefined>;
  write(serverKey: string, authorization: StoredAuthorization): Promise<void>;
  delete(serverKey: string): Promise<void>;
}

/** secure-storage 根上的文件实现：tokens/<key>.json，原子写、缺省 undefined。 */
export function createAuthorizationStore(storage: SecureStorage): AuthorizationStore {
  const entry = (serverKey: string): string => `tokens/${tokenFileKey(serverKey)}.json`;
  return {
    async read(serverKey) {
      const file = entry(serverKey);
      if (!(await storage.fileExists(file))) return undefined;
      try {
        const parsed: unknown = JSON.parse(await storage.readTextFile(file));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
        const record = parsed as Partial<StoredAuthorization> & Record<string, unknown>;
        if (typeof record.accessToken !== "string" || record.accessToken === "") return undefined;
        if (typeof record.profile !== "object" || record.profile === null) return undefined;
        const profile = record.profile as Partial<GrantProfile>;
        if (
          typeof profile.tokenEndpoint !== "string" ||
          typeof profile.clientId !== "string" ||
          typeof profile.resource !== "string"
        ) {
          return undefined;
        }
        return {
          accessToken: record.accessToken,
          ...(typeof record.refreshToken === "string" ? { refreshToken: record.refreshToken } : {}),
          ...(typeof record.expiresAt === "number" ? { expiresAt: record.expiresAt } : {}),
          ...(typeof record.scope === "string" ? { scope: record.scope } : {}),
          profile: {
            tokenEndpoint: profile.tokenEndpoint,
            clientId: profile.clientId,
            resource: profile.resource,
            ...(typeof profile.scope === "string" ? { scope: profile.scope } : {}),
          },
          ...(typeof record.storedAt === "number" ? { storedAt: record.storedAt } : { storedAt: 0 }),
        };
      } catch {
        return undefined;
      }
    },
    async write(serverKey, authorization) {
      await storage.writeFileAtomic(
        entry(serverKey),
        JSON.stringify({ ...authorization, storedAt: Date.now() }, null, 2),
      );
    },
    async delete(serverKey) {
      await storage.deleteFile(entry(serverKey));
    },
  };
}

/** 到期前瞻（默认 30s 滑差）：过期或临近过期都应刷新。 */
export const REFRESH_SKEW_MS = 30_000;

export function needsRefresh(tokens: TokenSet, now = Date.now(), skewMs = REFRESH_SKEW_MS): boolean {
  if (tokens.expiresAt === undefined) return false;
  return tokens.expiresAt - skewMs <= now;
}
