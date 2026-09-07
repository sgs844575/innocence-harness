// OAuth 受保护资源元数据发现（RFC 9729）与授权服务器元数据发现
// （RFC 8414）：MCP 规范的 HTTP 服务器在未授权时以 401 + WWW-Authenticate
// 头指向资源元数据文档，客户端从该文档取 authorization_servers 再发现
// 授权端点。本模块只做解析与校验，网络访问全部经注入的 fetchImpl，
// 保持包自身零 IO 假设、可用假端口测试。

/** fetch 的最小注入面（与全局 fetch 同形；测试可替换）。 */
export type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface WwwAuthenticateChallenge {
  /** realm 参数：资源元数据文档地址（RFC 9729）。 */
  realm: string;
  /** 其余参数原样保留（error、error_description 等诊断信息）。 */
  parameters: Record<string, string>;
}

/**
 * 解析 401 响应的 WWW-Authenticate 头。仅识别 Bearer 方案（MCP 授权
 * 规范采用的方案）；realm 缺失或头畸形时返回 undefined，由调用方按
 * “不可交互授权”降级。多挑战（逗号分隔多方案）取第一个 Bearer 挑战；
 * 逗号切分遵守引号段（quoted-string 内的逗号不是挑战边界）。
 */
function splitChallenges(header: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const char of header) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quoted && char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === "," && !quoted) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

export function parseWwwAuthenticate(header: string | null | undefined): WwwAuthenticateChallenge | undefined {
  if (typeof header !== "string" || header.trim() === "") return undefined;
  // RFC 7235 的逗号歧义：同一挑战的参数与多挑战都逗号分隔。`name=value`
  // 形态的段是前一个挑战的参数延续；非该形态（方案名后跟参数）才是新挑战。
  const authParamStart = /^\s*[A-Za-z0-9_-]+\s*=/;
  const challenges: string[] = [];
  for (const segment of splitChallenges(header)) {
    if (challenges.length > 0 && authParamStart.test(segment)) {
      challenges[challenges.length - 1] += `,${segment}`;
    } else {
      challenges.push(segment);
    }
  }
  for (const raw of challenges) {
    const [scheme, ...rest] = raw.trim().split(/\s+/);
    if (!scheme || scheme.toLowerCase() !== "bearer") continue;
    const parameters: Record<string, string> = {};
    const paramPattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,;\s]+))/g;
    const body = rest.join(" ");
    let match: RegExpExecArray | null;
    while ((match = paramPattern.exec(body)) !== null) {
      const value = match[2] !== undefined
        ? match[2].replace(/\\(.)/g, "$1")
        : match[3]!;
      parameters[match[1]!.toLowerCase()] = value;
    }
    if (typeof parameters.realm !== "string" || parameters.realm === "") return undefined;
    return { realm: parameters.realm, parameters };
  }
  return undefined;
}

/** 元数据文档 URL 的严格校验：仅 http(s)、不带凭据、无片段。 */
export function assertMetadataUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use http or https: ${value}`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${label} must not carry credentials or a fragment`);
  }
  return parsed.toString();
}

/** 资源元数据文档（RFC 9729）中本能力消费的字段。 */
export interface ResourceMetadata {
  authorizationServers: string[];
  scopesSupported?: string[];
}

interface MetadataRecord {
  authorization_servers?: unknown;
  authorizationServers?: unknown;
  scopes_supported?: unknown;
}

function readStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`metadata field "${field}" must be an array of non-empty strings`);
  }
  return value as string[];
}

async function fetchJson(url: string, fetchImpl: AuthFetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`metadata request to ${url} failed with HTTP ${response.status}`);
  }
  const text = await response.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("metadata document is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`metadata document at ${url} is not valid JSON`);
    throw error;
  }
}

/** 拉取并校验资源元数据文档（Bearer realm 指向的地址）。 */
export async function loadResourceMetadata(
  realmUrl: string,
  fetchImpl: AuthFetch,
): Promise<ResourceMetadata> {
  const url = assertMetadataUrl(realmUrl, "resource metadata URL");
  const raw = await fetchJson(url, fetchImpl);
  const record = raw as MetadataRecord;
  const authorizationServers = readStringArray(
    record.authorization_servers ?? record.authorizationServers,
    "authorization_servers",
  );
  if (authorizationServers.length === 0) {
    throw new Error("resource metadata declares no authorization servers");
  }
  const scopes = readStringArray(record.scopes_supported, "scopes_supported");
  return {
    authorizationServers: authorizationServers.map((server) =>
      assertMetadataUrl(server, "authorization server URL")),
    ...(scopes.length > 0 ? { scopesSupported: scopes } : {}),
  };
}

/** 授权服务器元数据文档（RFC 8414）中本能力消费的字段。 */
export interface AuthorizationServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

/** RFC 8414 的已知插入路径：well-known 段插在路径首段之后（有路径时），
 *  无路径时挂在根下。 */
export function wellKnownUrl(server: string, suffix: string): string {
  const base = assertMetadataUrl(server, "authorization server URL");
  const parsed = new URL(base);
  const prefix = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  parsed.pathname = `${prefix}/.well-known/${suffix}`;
  return parsed.toString();
}

/** 拉取并校验授权服务器元数据（.well-known/oauth-authorization-server）。 */
export async function loadAuthorizationServerMetadata(
  server: string,
  fetchImpl: AuthFetch,
): Promise<AuthorizationServerMetadata> {
  const url = wellKnownUrl(server, "oauth-authorization-server");
  const raw = await fetchJson(url, fetchImpl);
  const endpoint = (field: string): string => {
    const value = raw[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`authorization server metadata is missing "${field}"`);
    }
    return assertMetadataUrl(value, `${field}`);
  };
  return {
    authorizationEndpoint: endpoint("authorization_endpoint"),
    tokenEndpoint: endpoint("token_endpoint"),
  };
}
