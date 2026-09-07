import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSecureStorage } from "@innocenceharness/secure-storage-node";
import {
  createAccountAuthorizer,
  createAuthorizationStore,
  needsRefresh,
  tokenFileKey,
  type AuthorizationStore,
} from "../src/index";

const roots: string[] = [];
async function tempStore(): Promise<AuthorizationStore> {
  const root = await mkdtemp(path.join(tmpdir(), "auth-store-"));
  roots.push(root);
  return createAuthorizationStore(await openSecureStorage(root, { dirs: [] }));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("tokenFileKey", () => {
  it("keeps safe keys and hashes structural ones", () => {
    expect(tokenFileKey("my-server")).toBe("my-server");
    expect(tokenFileKey("bundle_deadbeef_name")).toBe("bundle_deadbeef_name");
    const hashed = tokenFileKey("a/b\\c");
    expect(hashed).toMatch(/^k-[0-9a-f]{24}$/);
    expect(hashed).not.toBe(tokenFileKey("a/b\\d"));
  });
});

describe("needsRefresh", () => {
  const now = 1_000_000;
  it("treats unknown expiry as never refreshing", () => {
    expect(needsRefresh({ accessToken: "a" }, now)).toBe(false);
  });

  it("refreshes inside the skew window", () => {
    expect(needsRefresh({ accessToken: "a", expiresAt: now + 29_000 }, now)).toBe(true);
    expect(needsRefresh({ accessToken: "a", expiresAt: now + 31_000 }, now)).toBe(false);
    expect(needsRefresh({ accessToken: "a", expiresAt: now - 1 }, now)).toBe(true);
  });
});

describe("createAuthorizationStore", () => {
  it("round-trips an authorization envelope", async () => {
    const store = await tempStore();
    const envelope = {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 123,
      scope: "read",
      profile: { tokenEndpoint: "https://as/token", clientId: "cid", resource: "https://mcp" },
      storedAt: 1,
    };
    await store.write("server", envelope);
    const stored = await store.read("server");
    expect(stored).toMatchObject({ ...envelope, storedAt: expect.any(Number) });
    expect(typeof stored?.storedAt).toBe("number");
    await store.delete("server");
    expect(await store.read("server")).toBeUndefined();
  });

  it("treats corrupted or shape-invalid envelopes as absent", async () => {
    const store = await tempStore();
    const storage = await openSecureStorage(roots[roots.length - 1]!, { dirs: [] });
    await storage.writeFileAtomic("tokens/broken.json", "{not json");
    expect(await store.read("broken")).toBeUndefined();
    await storage.writeFileAtomic(
      "tokens/shapeless.json",
      JSON.stringify({ accessToken: "x", profile: "nope" }),
    );
    expect(await store.read("shapeless")).toBeUndefined();
    await storage.writeFileAtomic(
      "tokens/keys.json",
      JSON.stringify({ accessToken: "x", profile: { tokenEndpoint: "https://t", clientId: "c", resource: "https://r" } }),
    );
    expect((await store.read("keys"))?.profile.tokenEndpoint).toBe("https://t");
  });
});

describe("createAccountAuthorizer", () => {
  const serverUrl = "https://mcp.example.com/mcp";

  function routeFetch(routes: {
    probe?: (headers: Record<string, string>) => Response;
    resource?: Response;
    authServer?: Response;
    token?: Response;
  }) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === serverUrl) return routes.probe?.(headersOf(init)) ?? new Response("ok");
      if (url === "https://rm.example.com/rm") {
        return routes.resource ?? new Response(
          JSON.stringify({ authorization_servers: ["https://as.example.com"] }),
          { status: 200 },
        );
      }
      if (url === "https://as.example.com/.well-known/oauth-authorization-server") {
        return routes.authServer ?? new Response(
          JSON.stringify({
            authorization_endpoint: "https://as.example.com/authorize",
            token_endpoint: "https://as.example.com/token",
          }),
          { status: 200 },
        );
      }
      if (url === "https://as.example.com/token") {
        return routes.token ?? new Response(JSON.stringify({ access_token: "fresh" }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }

  const headersOf = (init?: RequestInit): Record<string, string> => {
    const raw = init?.headers;
    if (!raw) return {};
    if (raw instanceof Headers) return Object.fromEntries(raw.entries());
    return Object.fromEntries(Object.entries(raw as Record<string, string>));
  };

  it("returns none when the server does not require authorization", async () => {
    const store = await tempStore();
    const authorizer = createAccountAuthorizer({
      store,
      fetchImpl: routeFetch({}),
      openExternal: async () => {},
    });
    expect(await authorizer.authorize({ key: "s", url: serverUrl })).toEqual({ status: "none" });
  });

  it("completes the interactive flow after consent and persists tokens", async () => {
    const store = await tempStore();
    const consents: unknown[] = [];
    const opened: string[] = [];
    let probing = true;
    const fetchImpl = routeFetch({
      probe: (headers) =>
        probing && headers.authorization !== "Bearer fresh"
          ? new Response("denied", { status: 401, headers: { "www-authenticate": 'Bearer realm="https://rm.example.com/rm"' } })
          : new Response("ok"),
      token: new Response(JSON.stringify({ access_token: "fresh", refresh_token: "r1" }), { status: 200 }),
    });
    const authorizer = createAccountAuthorizer({
      store,
      fetchImpl,
      openExternal: async (url) => {
        opened.push(url);
        const parsed = new URL(url);
        const redirect = parsed.searchParams.get("redirect_uri")!;
        await fetch(`${redirect}?${new URLSearchParams({ code: "g", state: parsed.searchParams.get("state")! })}`);
      },
      consent: async (server) => {
        consents.push(server);
        return true;
      },
    });
    const outcome = await authorizer.authorize({ key: "srv", url: serverUrl });
    expect(outcome).toEqual({ status: "authorized", headers: { authorization: "Bearer fresh" } });
    expect(consents).toEqual([{ key: "srv", url: serverUrl }]);
    expect(opened[0]).toContain("https://as.example.com/authorize");
    probing = false;
    const stored = await store.read("srv");
    expect(stored?.accessToken).toBe("fresh");
    expect(stored?.profile.tokenEndpoint).toBe("https://as.example.com/token");
    // 二次授权：已存令牌探测通过，直接复用，无同意卡。
    const again = await authorizer.authorize({ key: "srv", url: serverUrl });
    expect(again).toEqual({ status: "authorized", headers: { authorization: "Bearer fresh" } });
    expect(consents).toHaveLength(1);
  });

  it("reports declined when the consent port answers false", async () => {
    const store = await tempStore();
    const authorizer = createAccountAuthorizer({
      store,
      fetchImpl: routeFetch({
        probe: () => new Response("denied", { status: 401, headers: { "www-authenticate": 'Bearer realm="https://rm.example.com/rm"' } }),
      }),
      openExternal: async () => {},
      consent: async () => false,
    });
    expect(await authorizer.authorize({ key: "s", url: serverUrl })).toMatchObject({ status: "declined" });
  });

  it("refreshes a near-expiry stored token before probing", async () => {
    const store = await tempStore();
    await store.write("srv", {
      accessToken: "old",
      refreshToken: "r-old",
      expiresAt: Date.now() + 1000,
      profile: { tokenEndpoint: "https://as.example.com/token", clientId: "InnocenceHarness", resource: serverUrl },
      storedAt: 1,
    });
    const refreshes: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === serverUrl) return new Response("ok");
      if (url === "https://as.example.com/token") {
        refreshes.push(String(init?.body));
        return new Response(JSON.stringify({ access_token: "rotated" }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const outcome = await createAccountAuthorizer({
      store,
      fetchImpl,
      openExternal: async () => {},
    }).authorize({ key: "srv", url: serverUrl });
    expect(outcome).toEqual({ status: "authorized", headers: { authorization: "Bearer rotated" } });
    expect(refreshes[0]).toContain("refresh_token=r-old");
    expect((await store.read("srv"))?.accessToken).toBe("rotated");
  });

  it("fails closed when discovery cannot resolve endpoints", async () => {
    const store = await tempStore();
    const authorizer = createAccountAuthorizer({
      store,
      fetchImpl: routeFetch({
        probe: () => new Response("denied", { status: 401 }),
        resource: new Response("{}", { status: 200 }),
        authServer: new Response("{}", { status: 200 }),
      }),
      openExternal: async () => {},
      consent: async () => true,
    });
    // 401 无 WWW-Authenticate realm：无可发现元数据 → failed（不抛出）。
    expect(await authorizer.authorize({ key: "s", url: serverUrl })).toMatchObject({ status: "failed" });
  });
});
