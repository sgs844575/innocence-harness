// SSRF guard for the web fetch tool, two layers:
// (1) URL syntax plus hostname literal screening — localhost family and
//     intranet/loopback/link-local IP literals, with fully-qualified
//     trailing-dot forms normalized away first (dns.lookup still resolves
//     "localhost." to loopback, and URL parsing keeps the dot);
// (2) post-resolution re-screening — a name that passed layer 1 is resolved
//     (all addresses) and every returned address is held against the same IP
//     predicates; a private hit, a resolution failure or an expired time
//     budget all reject (fail closed). IP literals skip layer 2: layer 1
//     already judged the address itself.
// The screen resolves independently of the transport, so the rebinding
// window narrows to the gap between screen and connect — it is reduced by
// re-screening each followed redirect hop, not eliminated by pinning.

import { lookup as nodeDnsLookup } from "node:dns/promises";

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

/** Dotted-quad shape test (URL parsing canonicalizes shorthand/hex forms first). */
function isIPv4Literal(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function isPrivateIPv4Host(host: string): boolean {
  if (!isIPv4Literal(host)) return false;
  return privateIPv4Octets(host.split(".").map(Number));
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
 * Fully-qualified trailing dots stripped, case normalized — "a.example." and
 * "A.EXAMPLE" both reduce to the dotless lowercase form (a second trailing
 * dot is an invalid empty label; stripping it rejects those forms too). Valid
 * public hosts lose at most their FQDN dot, so no false positives.
 */
export function stripTrailingDots(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/** Bare-IP screening by shape: dotted quad or IPv6 literal, brackets optional. */
function isPrivateIpLiteral(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) return isPrivateIPv6Literal(host.slice(1, -1));
  if (host.includes(":")) return isPrivateIPv6Literal(host);
  return isPrivateIPv4Host(host);
}

/** True when the host IS an IP address rather than a name needing resolution. */
function isIpLiteralHost(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) return true;
  if (host.includes(":")) return true;
  return isIPv4Literal(host);
}

/**
 * Hostname literal screening: localhost family, private/loopback/link-local
 * IPv4, and non-global IPv6. URL parsing normalizes IPv4 shorthand/hex forms
 * before this runs (e.g. 0x7f.1 → 127.0.0.1), so dotted-quad checks suffice.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = stripTrailingDots(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isPrivateIpLiteral(host);
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

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Structural match of node:dns/promises lookup(hostname, { all: true }). */
export type DnsLookupLike = (hostname: string, options: { all: true }) => Promise<ResolvedAddress[]>;

export const DEFAULT_DNS_LOOKUP_TIMEOUT_MS = 3000;

export const defaultDnsLookup: DnsLookupLike = (hostname, options) => nodeDnsLookup(hostname, options);

/** Marker distinguishing the race timer from a lookup-side rejection. */
class DnsScreenTimeout extends Error {}

/**
 * Post-resolution re-screen for a hostname that passed the literal layer:
 * resolve every address and hold each one against the same intranet/loopback
 * predicates. Fail closed — a private hit, an empty result set, a lookup
 * error, or an expired time budget all reject. IP literals are skipped
 * (already judged as literals); a host that normalizes to the empty name is
 * rejected outright. Error messages echo the hostname only, never the path
 * or query.
 */
export async function screenResolvedHost(
  hostname: string,
  lookup: DnsLookupLike = defaultDnsLookup,
  timeoutMs: number = DEFAULT_DNS_LOOKUP_TIMEOUT_MS,
): Promise<void> {
  const host = stripTrailingDots(hostname);
  if (host === "") throw new Error("目标地址不允许：域名为空");
  if (isIpLiteralHost(host)) return;
  const lookupPromise = lookup(host, { all: true });
  // The race loser must carry its own rejection sink — a lookup that fails
  // after the budget elapsed would otherwise surface as an unhandled
  // rejection while the caller already saw the timeout.
  lookupPromise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolved: ResolvedAddress[];
  try {
    resolved = await Promise.race([
      lookupPromise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DnsScreenTimeout()), timeoutMs);
      }),
    ]);
  } catch (err) {
    if (err instanceof DnsScreenTimeout) {
      throw new Error(`目标地址不允许：域名 ${host} 解析超时（>${Math.round(timeoutMs / 1000)}s）`);
    }
    throw new Error(`目标地址不允许：域名 ${host} 解析失败`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (resolved.length === 0) throw new Error(`目标地址不允许：域名 ${host} 解析失败`);
  if (resolved.some((entry) => isPrivateIpLiteral(stripTrailingDots(entry.address)))) {
    throw new Error(`目标地址不允许：域名 ${host} 的解析结果命中内网/环回地址`);
  }
}
