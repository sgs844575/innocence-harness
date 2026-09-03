// 子代理按 id 取消（胶囊「暂停」钮链路）：
// 1) 会话级 cancelSubagent 直测——存活 childId 中止并回流 cancelled 生命周期
//    事件；终态后/未知 id → false；
// 2) RouteSessionCache.sessionsOf 按会话前缀枚举各路由缓存会话；
// 3) HarnessRuntime.cancelSubagent 跨路由委托（agentFactory 记录会话后打桩
//    验证逐路由尝试，未命中会话全程 false）。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Provider } from "@innocenceharness/harness-providers";
import type { SubagentLifecycleEvent } from "@innocenceharness/harness-agent";
import { createMockProvider } from "@innocenceharness/provider-mock";
import { AgentSession } from "../src/session";
import { RouteSessionCache } from "../src/route-cache";
import {
  DEFAULT_SETTINGS,
  HarnessRuntime,
  staticSpineSuite,
  type HarnessSettings,
  type RuntimeHooks,
  type RuntimeOptions,
} from "../src";

const allowDecider = { ask: async () => "deny" as const };

/** 挂起 provider：先出一段文本，然后等待中止信号再抛 AbortError（确定可中止）。 */
function hangingProvider(): Provider {
  const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
  return {
    id: "hanging",
    async *chat(req) {
      yield { type: "text", text: "开始" };
      if (req.signal?.aborted) throw abortError();
      await new Promise<never>((_, reject) => {
        req.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    },
  };
}

describe("AgentSession.cancelSubagent", () => {
  it("存活 childId：中止该运行并回流 cancelled 生命周期；终态后与未知 id → false", async () => {
    const events: SubagentLifecycleEvent[] = [];
    const session = await AgentSession.create({
      plugins: [],
      provider: hangingProvider(),
      spine: staticSpineSuite(),
      workspaceRoot: "D:/tmp",
      permission: { mode: "auto", decider: allowDecider },
      lifecycle: { emit: (event) => events.push(event) },
    });
    try {
      const pending = session.spawner.run({
        systemPrompt: "CHILD",
        tools: "readOnly",
        prompt: "挂起任务",
        description: "挂起子代理",
      });
      // started 在并发槽获取后同步发出；轮询事件数组直到出现（无超时假失败）。
      const started = await new Promise<SubagentLifecycleEvent>((resolve) => {
        const check = (): void => {
          const hit = events.find((event) => event.status === "started");
          if (hit) resolve(hit);
          else setTimeout(check, 5);
        };
        check();
      });
      expect(session.cancelSubagent(started.childId)).toBe(true);
      await pending.catch(() => undefined);
      expect(events.some((event) => event.childId === started.childId && event.status === "cancelled")).toBe(true);
      // 终态后与未知 id 都是安全 no-op（false）。
      expect(session.cancelSubagent(started.childId)).toBe(false);
      expect(session.cancelSubagent("missing_child")).toBe(false);
    } finally {
      await session.dispose();
    }
  });
});

describe("RouteSessionCache.sessionsOf", () => {
  it("按 `${sessionId}:` 前缀枚举该会话全部路由的缓存会话", () => {
    const cache = new RouteSessionCache({
      build: async () => {
        throw new Error("not used");
      },
      settleDispose: async () => {},
      log: () => {},
    });
    const main = { id: "main" } as unknown as AgentSession;
    const route2 = { id: "route2" } as unknown as AgentSession;
    const other = { id: "other" } as unknown as AgentSession;
    cache.commit("sess:main", "k", main);
    cache.commit("sess:route_2", "k", route2);
    cache.commit("other:main", "k", other);
    expect(cache.sessionsOf("sess")).toEqual([main, route2]);
    expect(cache.sessionsOf("none")).toEqual([]);
  });
});

describe("HarnessRuntime.cancelSubagent", () => {
  let persistDir: string;

  beforeAll(async () => {
    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-cancel-"));
  });

  afterAll(async () => {
    await fs.rm(persistDir, { recursive: true, force: true });
  });

  it("逐路由委托到缓存会话；未命中会话（无缓存/未知 id）→ false", async () => {
    const settings: HarnessSettings = { ...DEFAULT_SETTINGS };
    const hooks: RuntimeHooks = {
      onDelta: () => {},
      onTool: () => {},
      onThinking: () => {},
      onCompleted: () => {},
      onError: () => {},
      askPermission: async () => "allow",
      log: () => {},
    };
    const options: RuntimeOptions = {
      settings: () => settings,
      hooks,
      persistDir,
      providerFactory: () => createMockProvider({ turns: [{ text: "ok" }] }),
      pluginsForSession: () => [],
      sessionSpine: () => staticSpineSuite(),
    };
    const built = new Map<AgentSession, string>();
    const runtime = new HarnessRuntime({
      ...options,
      agentFactory: async (context, create) => {
        const session = await create();
        built.set(session, `${context.sessionId}:${context.routeId}`);
        return session;
      },
    });
    try {
      await runtime.send({ sessionId: "sess-cancel", taskId: "", routeId: "main", text: "打个招呼", messageId: "m1" });
      expect(built.size).toBe(1);
      const [session] = built.keys();
      // 打桩验证委托真的到达该会话的 cancelSubagent（childId 透传）。
      const spy = vi.spyOn(session!, "cancelSubagent").mockReturnValue(true);
      expect(runtime.cancelSubagent("sess-cancel", "child_x")).toBe(true);
      expect(spy).toHaveBeenCalledWith("child_x");
      spy.mockRestore();
      // 无缓存会话 → 全程 false。
      expect(runtime.cancelSubagent("sess-none", "child_x")).toBe(false);
    } finally {
      await runtime.disposeAll();
    }
  });
});
