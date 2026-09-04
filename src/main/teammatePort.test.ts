// Teammate port tests (batch 4E task 1): the host-side sendToTeammate
// implementation against fakes — route resolution (task routes minus the
// sending route are the teammate namespace), envelope-carrying delivery
// through the runtime send face, reply collection through the REAL
// automation reply observer (the fake runtime mirrors deltas exactly like
// the runtime hooks do), and the fail-fast refusals: no task, unknown
// teammate, self-address, busy route, errored turn.
import { describe, expect, it } from "vitest";
import { buildTeammateTurn, TEAMMATE_EMPTY_REPLY, TEAMMATE_MESSAGE_ENVELOPE } from "@innocenceharness/plugin-team";
import { appendObservedReplyDelta, markObservedReplyError } from "./automationReplyObserver";
import { createSendToTeammate, type TeammateRuntimePort } from "./teammatePort";

interface DeliveredTurn {
  sessionId: string;
  taskId: string;
  routeId: string;
  text: string;
  messageId: string;
}

/**
 * Fake runtime: records the delivered turn, then mirrors the scripted reply
 * into the real observer (delta-per-chunk like the runtime hooks) before the
 * send promise resolves — the exact collection window the port relies on.
 */
function fakeRuntime(script: {
  reply?: string;
  error?: string;
  busyRoutes?: Set<string>;
  reject?: Error;
}): { runtime: TeammateRuntimePort; delivered: DeliveredTurn[] } {
  const delivered: DeliveredTurn[] = [];
  const runtime: TeammateRuntimePort = {
    async send(input) {
      delivered.push({ ...input });
      if (script.reject) throw script.reject;
      if (script.error) markObservedReplyError(input.messageId, script.error);
      else if (script.reply !== undefined) {
        for (const chunk of script.reply.split("|")) {
          appendObservedReplyDelta(input.messageId, chunk);
        }
      }
    },
    isRouteRunning: (sessionId, routeId) =>
      script.busyRoutes?.has(`${sessionId}:${routeId}`) ?? false,
  };
  return { runtime, delivered };
}

function makePort(
  routes: readonly string[],
  script: Parameters<typeof fakeRuntime>[0],
  identity: { sessionId?: string; routeId?: string; taskId?: string } = {},
) {
  const { runtime, delivered } = fakeRuntime(script);
  const port = createSendToTeammate(
    { runtime, listTeammateRoutes: async () => routes },
    {
      sessionId: identity.sessionId ?? "chat-1",
      routeId: identity.routeId ?? "main",
      ...(identity.taskId !== undefined ? { taskId: identity.taskId } : {}),
    },
  );
  return { port, delivered };
}

describe("teammate port: resolution and delivery", () => {
  it("delivers an envelope-carrying turn to the named route and collects the reply", async () => {
    const { port, delivered } = makePort(["main", "worker-1", "worker-2"], { reply: "all| done" }, { taskId: "task-9" });
    const result = await port("worker-1", "please check the build");
    expect(result).toEqual({ ok: true, reply: "all done" });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      sessionId: "chat-1",
      taskId: "task-9",
      routeId: "worker-1",
    });
    // 信封在正文之上：投递回合 = 对等权威信封 + 空行 + 原始消息。
    expect(delivered[0].text).toBe(buildTeammateTurn("please check the build"));
    expect(delivered[0].text.startsWith(TEAMMATE_MESSAGE_ENVELOPE)).toBe(true);
    expect(delivered[0].text).toContain("please check the build");
    expect(delivered[0].messageId.startsWith("team_")).toBe(true);
  });

  it("unique message ids per delivery (observer keys never collide)", async () => {
    const { port, delivered } = makePort(["main", "worker-1"], { reply: "a" }, { taskId: "t" });
    await port("worker-1", "one");
    await port("worker-1", "two");
    const ids = delivered.map((turn) => turn.messageId);
    expect(new Set(ids).size).toBe(2);
  });

  it("host-mirrored pseudo rows never count as the reply: pseudo-only falls back to the placeholder", async () => {
    // runtime-events 把压缩/非致命错误以 "> 🗜️ 已压缩…" / "> ⚠️ …" 合成
    // delta 镜像进 onDelta——无正文但触发压缩的队友回合不得把宿主伪行当
    // 回复；剥离后为空回落 TEAMMATE_EMPTY_REPLY 占位。
    const { port } = makePort(
      ["main", "worker-1"],
      { reply: "\n\n> 🗜️ 已压缩较早的对话历史\n\n> ⚠️ transient provider hiccup\n" },
      { taskId: "task-9" },
    );
    const result = await port("worker-1", "hi");
    expect(result).toEqual({ ok: true, reply: TEAMMATE_EMPTY_REPLY });
  });

  it("body text plus pseudo rows returns only the body", async () => {
    const { port } = makePort(
      ["main", "worker-1"],
      { reply: "\n\n> 🗜️ 已压缩较早的对话历史\nthe actual teammate answer\n\n> ⚠️ retried once\n" },
      { taskId: "task-9" },
    );
    const result = await port("worker-1", "hi");
    expect(result).toEqual({ ok: true, reply: "the actual teammate answer" });
  });
});

describe("teammate port: fail-fast refusals", () => {
  it("no task bound: no named teammates exist", async () => {
    const { port, delivered } = makePort(["main"], { reply: "x" });
    const result = await port("anyone", "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no named teammates/i);
    expect(delivered).toHaveLength(0);
  });

  it("unknown teammate: error lists the available teammates and complete raw message", async () => {
    const { port, delivered } = makePort(["main", "worker-1"], { reply: "x" }, { taskId: "task-9" });
    const result = await port("ghost", "secret payload");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("worker-1");
      expect(result.error).toContain("secret payload");
    }
    expect(delivered).toHaveLength(0);
  });

  it("task with no other routes: any name is refused", async () => {
    const { port } = makePort(["main"], { reply: "x" }, { taskId: "task-9" });
    const result = await port("worker-9", "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no other named routes/i);
  });

  it("self-address: a route cannot send to itself", async () => {
    const { port, delivered } = makePort(["main", "worker-1"], { reply: "x" }, { routeId: "worker-1", taskId: "task-9" });
    const result = await port("worker-1", "loop");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/itself/i);
    expect(delivered).toHaveLength(0);
  });

  it("busy teammate route: refused before delivery (one turn per route)", async () => {
    const { port, delivered } = makePort(
      ["main", "worker-1"],
      { reply: "x", busyRoutes: new Set(["chat-1:worker-1"]) },
      { taskId: "task-9" },
    );
    const result = await port("worker-1", "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/busy/i);
    expect(delivered).toHaveLength(0);
  });

  it("errored teammate turn: reported as a failed delivery", async () => {
    const diagnostic = "provider failed with secret payload";
    const { port } = makePort(["main", "worker-1"], { reply: "partial", error: diagnostic }, { taskId: "task-9" });
    const result = await port("worker-1", "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(diagnostic);
  });

  it("runtime.send rejection: surfaced as a delivery failure, observer entry released", async () => {
    const { port } = makePort(["main", "worker-1"], { reject: new Error("route disposed") }, { taskId: "task-9" });
    const result = await port("worker-1", "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("route disposed");
  });
});
