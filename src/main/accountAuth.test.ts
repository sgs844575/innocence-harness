import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatQuestionEvent, ChatQuestionResponse } from "../shared/ipc";
import {
  accountTokensRoot,
  createMcpAuthorizationPort,
  resetAccountAuthCache,
  type AccountAuthServiceDeps,
} from "./accountAuth";
import type { PendingQuestion, PendingQuestionRegistry, AskUserQueueRegistry } from "./askUserPort";

const roots: string[] = [];
afterEach(async () => {
  resetAccountAuthCache();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fakeDeps(overrides?: Partial<AccountAuthServiceDeps>) {
  const pendingQuestions: PendingQuestionRegistry = new Map<string, PendingQuestion>();
  const askQueues: AskUserQueueRegistry = new Map<string, Promise<void>>();
  const events: ChatQuestionEvent[] = [];
  const settled: string[] = [];
  const deps: AccountAuthServiceDeps = {
    pendingQuestions,
    askQueues,
    send: (event) => events.push(event),
    sendSettled: (requestId) => settled.push(requestId),
    resolveMessageId: () => "msg-1",
    questionAutoContinue: () => false,
    tokensRoot: () => roots[roots.length - 1] ?? "",
    openExternal: async () => {},
    ...overrides,
  };
  return { deps, pendingQuestions, events, settled };
}

describe("accountTokensRoot", () => {
  it("appends the hardened tokens directory to the data root", () => {
    expect(accountTokensRoot(path.join(tmpdir(), "innocence"))).toBe(
      path.join(tmpdir(), "innocence", "auth-tokens"),
    );
  });
});

describe("createMcpAuthorizationPort", () => {
  const serverUrl = "https://mcp.example.com/mcp";

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "account-auth-"));
    roots.push(root);
    return root;
  }

  function routeFetch() {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === serverUrl) {
        const header = new Headers(init?.headers).get("authorization");
        return header === "Bearer fresh"
          ? new Response("ok")
          : new Response("denied", { status: 401, headers: { "www-authenticate": 'Bearer realm="https://rm.example.com/rm"' } });
      }
      if (url === "https://rm.example.com/rm") {
        return new Response(JSON.stringify({ authorization_servers: ["https://as.example.com"] }));
      }
      if (url === "https://as.example.com/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          authorization_endpoint: "https://as.example.com/authorize",
          token_endpoint: "https://as.example.com/token",
        }));
      }
      if (url === "https://as.example.com/token") {
        return new Response(JSON.stringify({ access_token: "fresh" }));
      }
      throw new Error(`unexpected fetch ${url}`);
    };
  }

  it("runs the consent card through the ask-port registry and completes the flow", async () => {
    await tempRoot();
    const harness = fakeDeps({
      fetchImpl: routeFetch(),
      openExternal: async (authorizeUrl) => {
        const parsed = new URL(authorizeUrl);
        const redirect = parsed.searchParams.get("redirect_uri")!;
        await fetch(`${redirect}?${new URLSearchParams({ code: "g", state: parsed.searchParams.get("state")! })}`);
      },
    });
    const port = createMcpAuthorizationPort(harness.deps, { sessionId: "s1", routeId: "main" });
    const pending = port({ name: "remote", url: serverUrl });
    // 同意卡经注册表浮出：以「打开浏览器授权」应答。
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (harness.pendingQuestions.size > 0) resolve();
        else setTimeout(tick, 5);
      };
      tick();
    });
    const [entry] = [...harness.pendingQuestions.values()];
    expect(entry.event.questions[0]?.header).toBe("账号授权");
    expect(entry.event.questions[0]?.options.map((option) => option.label))
      .toEqual(["打开浏览器授权", "跳过"]);
    const response: ChatQuestionResponse = {
      answers: [{ question: entry.event.questions[0]!.question, answers: ["打开浏览器授权"] }],
    };
    entry.finish(response);
    expect(await pending).toEqual({ status: "authorized", headers: { authorization: "Bearer fresh" } });
    expect(harness.settled).toHaveLength(1);
    // 令牌已落盘：第二次直用，无新同意卡。
    const again = await port({ name: "remote", url: serverUrl });
    expect(again).toEqual({ status: "authorized", headers: { authorization: "Bearer fresh" } });
    expect(harness.events).toHaveLength(1);
  });

  it("maps a skipped card to declined without touching the browser", async () => {
    await tempRoot();
    const opened: string[] = [];
    const harness = fakeDeps({
      fetchImpl: routeFetch(),
      openExternal: async (url) => { opened.push(url); },
    });
    const port = createMcpAuthorizationPort(harness.deps, { sessionId: "s1", routeId: "main" });
    const pending = port({ name: "remote", url: serverUrl });
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (harness.pendingQuestions.size > 0) resolve();
        else setTimeout(tick, 5);
      };
      tick();
    });
    [...harness.pendingQuestions.values()][0]!.finish(null);
    expect(await pending).toMatchObject({ status: "declined" });
    expect(opened).toEqual([]);
  });
});
