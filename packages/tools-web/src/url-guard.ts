// SSRF baseline guard for the web fetch tool: URL syntax plus hostname
// literal screening (fully-qualified trailing-dot forms normalized away —
// dns.lookup still resolves "localhost." to loopback). v1 scope, disclosed in
// the tool description: literals and localhost only. A hostname that RESOLVES
// into a private range passes this screen, and nothing downstream resolves it
// either — permission rules match hostnames verbatim — so DNS-resolved IP
// re-validation (rebinding defense) is a later hardening step, not a covered
// layer.

/** Private/loopback/link-local/unspecified IPv4 ranges (octet predicates). */
function privateIPv4Octets(octets: number[]): boolean {
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  return (
    a === 0 || // 0.0.0.0/8 "this network" — includes the unspecified address
    a === 10 || // 10.0.0.0/8 private
    a === 127 || // 127.0.0.0/8 loopback
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (metadata services)
    (a === 192 && b === 168) // 192.168.0.0/16 private
  );
}

function isPrivateIPv4Host(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return privateIPv4Octets(octets);
}

/** Embedded IPv4 tail of an IPv6 literal → its two 16-bit groups. */
function ipv4TailToGroups(text: string): number[] | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map(Number);
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return undefined;
  return [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
}

/** Expand an IPv6 literal into eight 16-bit groups; undefined when unparseable. */
function expandIPv6Literal(host: string): number[] | undefined {
  const sides = host.split("::");
  if (sides.length > 2) return undefined;
  const parseSide = (side: string): number[] | undefined => {
    if (side === "") return [];
    const groups: number[] = [];
    for (const part of side.split(":")) {
      if (part.includes(".")) {
        const embedded = ipv4TailToGroups(part);
        if (embedded === undefined) return undefined;
        groups.push(...embedded);
      } else if (/^[0-9a-f]{1,4}$/.test(part)) {
        groups.push(parseInt(part, 16));
      } else {
        return undefined;
      }
    }
    return groups;
  };
  const head = parseSide(sides[0] ?? "");
  if (head === undefined) return undefined;
  if (sides.length === 1) return head.length === 8 ? head : undefined;
  const tail = parseSide(sides[1] ?? "");
  if (tail === undefined) return undefined;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return undefined;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function isPrivateIPv6Literal(host: string): boolean {
  const groups = expandIPv6Literal(host);
  if (groups === undefined) return true; // unparseable literal — fail closed
  const first = groups[0] ?? 0;
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if (first !== 0) return false;
  // "::"-prefixed forms: unspecified/loopback/IPv4-mapped all reduce to the
  // trailing 32 bits (::1 → 0.0.0.1, ::ffff:127.0.0.1 → 127.0.0.1, …).
  const g6 = groups[6] ?? 0;
  const g7 = groups[7] ?? 0;
  return privateIPv4Octets([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
}

/**
 * Hostname literal screening: localhost family, private/loopback/link-local
 * IPv4, and non-global IPv6. URL parsing normalizes IPv4 shorthand/hex forms
 * before this runs (e.g. 0x7f.1 → 127.0.0.1), so dotted-quad checks suffice.
 */
export function isPrivateHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  // Fully-qualified trailing dot(s): "localhost." and "api.localhost." are the
  // same DNS names as their dotless forms (a second trailing dot is an invalid
  // empty label — stripping it rejects those forms too). Valid public hosts
  // lose at most their FQDN dot, so no false positives.
  while (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("[") && host.endsWith("]")) return isPrivateIPv6Literal(host.slice(1, -1));
  if (host.includes(":")) return isPrivateIPv6Literal(host);
  return isPrivateIPv4Host(host);
}

export interface ParsedWebTarget {
  url: URL;
  host: string;
}

/**
 * Syntax + SSRF baseline validation. Error messages echo the protocol and
 * host only (both non-sensitive and useful for correction) — never the path
 * or query.
 */
export function parseWebTarget(raw: string): ParsedWebTarget {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("url 必须是合法的 http/https 绝对地址");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("url 必须是合法的 http/https 绝对地址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `目标地址不允许：仅支持 http/https 协议（收到 ${url.protocol.replace(/:$/, "")}，主机 ${url.hostname}）`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`目标地址不允许：URL 内嵌登录凭据（主机 ${url.hostname}）`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error(`目标地址不允许：内网/环回地址 ${url.hostname}`);
  }
  return { url, host: url.hostname };
}
