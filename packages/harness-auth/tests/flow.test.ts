import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  codeChallengeS256,
  createCodeVerifier,
  postTokenRequest,
  refreshTokens,
  runAuthorizationCodeFlow,
  startLoopbackReceiver,
  type AuthFetch,
} from "../src/index";

// RFC 7636 appendix B test vector.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("pkce", () => {
  it("derives the S256 challenge of the RFC 7636 vector", () => {
    expect(codeChallengeS256(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it("mints verifiers in the allowed alphabet", () => {
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });
});

describe("buildAuthorizationUrl", () => {
  it("carries response_type, pkce, state, and resource parameters", () => {
    const url = new URL(buildAuthorizationUrl({
      authorizationEndpoint: "https://as.example.com/authorize?tenant=1",
      redirectUri: "http://127.0.0.1:1234/callback",
      clientId: "cid",
      resource: "https://mcp.example.com/mcp",
      scope: "read write",
      state: "st",
      codeChallenge: RFC_CHALLENGE,
    }));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1234/callback");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge")).toBe(RFC_CHALLENGE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe("https://mcp.example.com/mcp");
    expect(url.searchParams.get("scope")).toBe("read write");
    expect(url.searchParams.get("tenant")).toBe("1");
  });
});

describe("postTokenRequest", () => {
  it("parses a token response and computes the expiry clock", async () => {
    const fetchImpl: AuthFetch = async (url, init) => {
      expect(url).toBe("https://as.example.com/token");
      expect(String(init?.body)).toContain("grant_type=authorization_code");
      return new Response(
        JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "read" }),
        { status: 200 },
      );
    };
    const result = await postTokenRequest(
      "https://as.example.com/token",
      { grant_type: "authorization_code", code: "c" },
      fetchImpl,
    );
    expect(result.accessToken).toBe("at");
    expect(result.refreshToken).toBe("rt");
    expect(result.scope).toBe("read");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("surfaces the OAuth error code on failure", async () => {
    const fetchImpl: AuthFetch = async () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "stale" }), { status: 400 });
    await expect(postTokenRequest("https://as.example.com/token", {}, fetchImpl))
      .rejects.toThrow(/token exchange failed \(invalid_grant\): stale/);
  });
});

describe("refreshTokens", () => {
  it("sends the refresh grant and reuses the old refresh token when omitted", async () => {
    const bodies: string[] = [];
    const fetchImpl: AuthFetch = async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ access_token: "at2" }), { status: 200 });
    };
    const result = await refreshTokens(
      { accessToken: "at", refreshToken: "rt" },
      { tokenEndpoint: "https://as.example.com/token", clientId: "cid" },
      fetchImpl,
    );
    expect(bodies[0]).toContain("grant_type=refresh_token");
    expect(bodies[0]).toContain("refresh_token=rt");
    expect(result.refreshToken).toBe("rt");
  });

  it("refuses without a refresh token", async () => {
    await expect(
      refreshTokens({ accessToken: "at" }, { tokenEndpoint: "https://x/token", clientId: "c" }, async () => new Response("{}")),
    ).rejects.toThrow(/no refresh token/);
  });
});

describe("startLoopbackReceiver", () => {
  it("receives one callback query and then closes cleanly", async () => {
    const receiver = await startLoopbackReceiver();
    expect(receiver.redirectUri).toBe(`http://127.0.0.1:${receiver.port}/callback`);
    const pending = receiver.waitForCallback(new AbortController().signal);
    const response = await fetch(`${receiver.redirectUri}?code=abc&state=st`);
    expect(response.status).toBe(200);
    expect(await pending).toEqual({ code: "abc", state: "st" });
    await receiver.close();
  });

  it("buffers an early callback until a waiter arrives", async () => {
    const receiver = await startLoopbackReceiver();
    await fetch(`${receiver.redirectUri}?code=early`);
    const query = await receiver.waitForCallback(new AbortController().signal);
    expect(query.code).toBe("early");
    await receiver.close();
  });
});

describe("runAuthorizationCodeFlow", () => {
  const tokenEndpoint = "https://as.example.com/token";

  function flowHarness(overrides?: {
    callback?: (params: URLSearchParams) => string | URLSearchParams;
    tokenResponse?: () => Response;
  }) {
    const seen: { authorizeUrl?: string; exchanged?: string } = {};
    const fetchImpl: AuthFetch = async (url) => {
      if (url === tokenEndpoint) {
        seen.exchanged = "called";
        return overrides?.tokenResponse?.() ?? new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const openExternal = async (authorizeUrl: string): Promise<void> => {
      seen.authorizeUrl = authorizeUrl;
      const url = new URL(authorizeUrl);
      const redirect = url.searchParams.get("redirect_uri")!;
      const state = url.searchParams.get("state")!;
      const query = overrides?.callback?.(url.searchParams) ?? new URLSearchParams({ code: "grant", state });
      await fetch(`${redirect}?${query.toString()}`);
    };
    return { seen, fetchImpl, openExternal };
  }

  const baseInput = (h: ReturnType<typeof flowHarness>) => ({
    authorizationEndpoint: "https://as.example.com/authorize",
    tokenEndpoint,
    resource: "https://mcp.example.com/mcp",
    clientId: "cid",
    fetchImpl: h.fetchImpl,
    openExternal: h.openExternal,
    signal: new AbortController().signal,
  });

  it("completes the code exchange with pkce", async () => {
    const harness = flowHarness();
    const tokens = await runAuthorizationCodeFlow(baseInput(harness));
    expect(tokens.accessToken).toBe("at");
    expect(harness.seen.authorizeUrl).toBeDefined();
    expect(harness.seen.exchanged).toBe("called");
  });

  it("rejects a state mismatch", async () => {
    const harness = flowHarness({
      callback: (params) => new URLSearchParams({ code: "grant", state: `${params.get("state")}!` }),
    });
    await expect(runAuthorizationCodeFlow(baseInput(harness))).rejects.toThrow(/state mismatch/);
  });

  it("rejects an error callback (user declined)", async () => {
    const harness = flowHarness({
      callback: (params) => new URLSearchParams({ error: "access_denied", state: params.get("state")! }),
    });
    await expect(runAuthorizationCodeFlow(baseInput(harness))).rejects.toThrow(/access_denied/);
  });

  it("rejects a callback without a code", async () => {
    const harness = flowHarness({
      callback: (params) => new URLSearchParams({ state: params.get("state")! }),
    });
    await expect(runAuthorizationCodeFlow(baseInput(harness))).rejects.toThrow(/no authorization code/);
  });

  it("propagates token endpoint failures", async () => {
    const harness = flowHarness({
      tokenResponse: () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    });
    await expect(runAuthorizationCodeFlow(baseInput(harness))).rejects.toThrow(/invalid_grant/);
  });
});
