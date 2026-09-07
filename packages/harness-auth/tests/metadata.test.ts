import { describe, expect, it } from "vitest";
import {
  assertMetadataUrl,
  loadAuthorizationServerMetadata,
  loadResourceMetadata,
  parseWwwAuthenticate,
  wellKnownUrl,
  type AuthFetch,
} from "../src/metadata";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("parseWwwAuthenticate", () => {
  it("parses a bearer challenge with a quoted realm", () => {
    const challenge = parseWwwAuthenticate(`Bearer realm="https://auth.example.com/.well-known/oauth-protected-resource"`);
    expect(challenge?.realm).toBe("https://auth.example.com/.well-known/oauth-protected-resource");
  });

  it("parses unquoted parameters and lowercases names", () => {
    const challenge = parseWwwAuthenticate(`Bearer realm=https://mcp.example.com/meta, error=invalid_token`);
    expect(challenge?.realm).toBe("https://mcp.example.com/meta");
    expect(challenge?.parameters.error).toBe("invalid_token");
  });

  it("unescapes quoted-string escapes inside realm", () => {
    const challenge = parseWwwAuthenticate(`Bearer realm="https://ex.example.com/a\\\"b"`);
    expect(challenge?.realm).toBe('https://ex.example.com/a"b');
  });

  it("skips non-bearer schemes and takes the first bearer challenge", () => {
    const challenge = parseWwwAuthenticate(`Basic realm="x", Bearer realm="https://as.example/rm"`);
    expect(challenge?.realm).toBe("https://as.example/rm");
  });

  it("returns undefined for a bearer challenge without realm", () => {
    expect(parseWwwAuthenticate(`Bearer error="invalid_token"`)).toBeUndefined();
    expect(parseWwwAuthenticate("")).toBeUndefined();
    expect(parseWwwAuthenticate(undefined)).toBeUndefined();
  });
});

describe("assertMetadataUrl", () => {
  it("accepts plain https urls", () => {
    expect(assertMetadataUrl("https://example.com/a?b=1", "url")).toBe("https://example.com/a?b=1");
  });

  it("rejects non-http schemes, credentials, fragments, and junk", () => {
    expect(() => assertMetadataUrl("ftp://example.com", "url")).toThrow(/http or https/);
    expect(() => assertMetadataUrl("https://user:pw@example.com", "url")).toThrow(/credentials/);
    expect(() => assertMetadataUrl("https://example.com/#frag", "url")).toThrow(/fragment/);
    expect(() => assertMetadataUrl("not a url", "url")).toThrow(/not a valid URL/);
  });
});

describe("wellKnownUrl", () => {
  it("mounts under the root when the issuer has no path", () => {
    expect(wellKnownUrl("https://as.example.com", "oauth-authorization-server"))
      .toBe("https://as.example.com/.well-known/oauth-authorization-server");
  });

  it("inserts the well-known segment after the issuer path", () => {
    expect(wellKnownUrl("https://as.example.com/tenant", "oauth-authorization-server"))
      .toBe("https://as.example.com/tenant/.well-known/oauth-authorization-server");
  });
});

describe("loadResourceMetadata", () => {
  const fetchOk: AuthFetch = async () =>
    jsonResponse({ authorization_servers: ["https://as.example.com"], scopes_supported: ["read", "write"] });

  it("parses and validates the document", async () => {
    const metadata = await loadResourceMetadata("https://rm.example.com/doc", fetchOk);
    expect(metadata.authorizationServers).toEqual(["https://as.example.com/"]);
    expect(metadata.scopesSupported).toEqual(["read", "write"]);
  });

  it("rejects documents without authorization servers", async () => {
    await expect(loadResourceMetadata("https://rm.example.com/doc", async () => jsonResponse({})))
      .rejects.toThrow(/no authorization servers/);
  });

  it("rejects non-JSON bodies and HTTP errors", async () => {
    await expect(
      loadResourceMetadata("https://rm.example.com/doc", async () => new Response("nope", { status: 200 })),
    ).rejects.toThrow(/not valid JSON/);
    await expect(
      loadResourceMetadata("https://rm.example.com/doc", async () => jsonResponse({ a: 1 }, 500)),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("loadAuthorizationServerMetadata", () => {
  it("requires both endpoints", async () => {
    const fetchImpl: AuthFetch = async (url) => {
      expect(url).toBe("https://as.example.com/.well-known/oauth-authorization-server");
      return jsonResponse({
        authorization_endpoint: "https://as.example.com/authorize",
        token_endpoint: "https://as.example.com/token",
      });
    };
    const metadata = await loadAuthorizationServerMetadata("https://as.example.com", fetchImpl);
    expect(metadata.authorizationEndpoint).toBe("https://as.example.com/authorize");
    expect(metadata.tokenEndpoint).toBe("https://as.example.com/token");
  });

  it("fails when the token endpoint is missing", async () => {
    const fetchImpl: AuthFetch = async () => jsonResponse({ authorization_endpoint: "https://as.example.com/authorize" });
    await expect(loadAuthorizationServerMetadata("https://as.example.com", fetchImpl))
      .rejects.toThrow(/missing "token_endpoint"/);
  });
});
