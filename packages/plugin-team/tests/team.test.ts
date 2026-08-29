// plugin-team tests (batch 4E task 1): the send_message tool contract
// (shape trio, field-name-only validation errors, permission resource,
// redacted persisted args, port fake three states + reply cap + empty
// reply), the peer-authority envelope anchors and turn composition, and
// the factory plugin mounting on a real kernel Context (the distribution
// default export is the factory itself).
import { describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin, sha256Hex } from "@innocenceharness/harness-tools";
import {
  NO_TEAMMATES_ERROR,
  SEND_MESSAGE_TOOL_NAME,
  TEAMMATE_EMPTY_REPLY,
  TEAMMATE_MESSAGE_ENVELOPE,
  TEAMMATE_REPLY_CAP,
  buildTeammateTurn,
  createSendMessageTool,
  createTeamPlugin,
  unavailableTeammatePort,
  type SendToTeammatePort,
  type TeamSendResult,
} from "../src";
import teamDefault from "../src";

const toolCtx = () =>
  ({
    workspaceRoot: "D:/work",
    signal: new AbortController().signal,
    log: () => {},
    scope: { sessionId: "s1", invocationId: "inv-1" },
  }) as never;

/** Fake port scripting one outcome per call (records the delivered pair). */
function fakePort(outcome: () => Promise<TeamSendResult>):
  SendToTeammatePort & { calls: Array<{ teammate: string; message: string }> } {
  const calls: Array<{ teammate: string; message: string }> = [];
  const port: SendToTeammatePort = async (teammate, message) => {
    calls.push({ teammate, message });
    return outcome();
  };
  return Object.assign(port, { calls });
}

describe("send_message tool shape", () => {
  const tool = createSendMessageTool({ sendToTeammate: unavailableTeammatePort });

  it("name/readOnly/sideEffect trio: delegated side effects live in the teammate session", () => {
    expect(tool.name).toBe(SEND_MESSAGE_TOOL_NAME);
    expect(SEND_MESSAGE_TOOL_NAME).toBe("send_message");
    expect(tool.readOnly).toBe(false);
    // 副作用发生在队友路由会话内、由其自行审计——父级不重复记账（同 Task 先例）。
    expect(tool.sideEffect).toBe("delegated");
  });

  it("parameters require teammate and message; description follows the Chinese tool style", () => {
    expect(tool.parameters).toMatchObject({
      type: "object",
      required: ["teammate", "message"],
    });
    expect((tool.parameters as { properties: Record<string, unknown> }).properties.teammate).toBeDefined();
    expect((tool.parameters as { properties: Record<string, unknown> }).properties.message).toBeDefined();
    expect(tool.description).toMatch(/具名队友/);
    expect(tool.description).toMatch(/跨回合保持上下文|持久路由会话/);
  });

  it("validateArgs rejects empty fields naming only the field", async () => {
    await expect(tool.validateArgs?.({})).rejects.toThrow(/teammate/);
    await expect(tool.validateArgs?.({ teammate: "alpha" })).rejects.toThrow(/message/);
    await expect(tool.validateArgs?.({ teammate: " ", message: "hi" })).rejects.toThrow(/teammate/);
    await expect(tool.validateArgs?.({ teammate: "alpha", message: "" })).rejects.toThrow(/message/);
    await expect(tool.validateArgs?.({ teammate: "alpha", message: "hi", extra: 1 })).resolves.toBeUndefined();
  });

  it("permission resource identifies the teammate only", () => {
    expect(tool.permissionResource({ teammate: "worker-1", message: "x" }, toolCtx())).toEqual({
      action: "send",
      kind: "teammate",
      scope: "worker-1",
    });
  });

  it("persistArgs carries the teammate and a message digest — never the message body", () => {
    const persisted = tool.persistArgs({ teammate: "worker-1", message: "secret body text" });
    expect(persisted).toEqual({
      teammate: "worker-1",
      messageSha256: sha256Hex("secret body text"),
    });
    expect(JSON.stringify(persisted)).not.toContain("secret body");
  });

  it("registration gate: all fail-closed SPI members exist", () => {
    expect(typeof tool.permissionResource).toBe("function");
    expect(typeof tool.persistArgs).toBe("function");
    expect(typeof tool.validateArgs).toBe("function");
    expect(typeof tool.execute).toBe("function");
  });
});

describe("send_message execution through the injected port", () => {
  it("ok: returns the teammate's final reply", async () => {
    const port = fakePort(async () => ({ ok: true, reply: "Done: the report is ready." }));
    const tool = createSendMessageTool({ sendToTeammate: port });
    const result = await tool.execute({ teammate: "alpha", message: "please summarize" }, toolCtx());
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe("Done: the report is ready.");
    expect(port.calls).toEqual([{ teammate: "alpha", message: "please summarize" }]);
  });

  it("!ok: isError with the port's error text (unknown teammate, delivery failure)", async () => {
    const port = fakePort(async () => ({ ok: false, error: 'Unknown teammate "ghost"; available teammates: alpha.' }));
    const tool = createSendMessageTool({ sendToTeammate: port });
    const result = await tool.execute({ teammate: "ghost", message: "hi" }, toolCtx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown teammate");
  });

  it("over-long replies are capped with a truncation note", async () => {
    const port = fakePort(async () => ({ ok: true, reply: "x".repeat(TEAMMATE_REPLY_CAP + 500) }));
    const tool = createSendMessageTool({ sendToTeammate: port });
    const result = await tool.execute({ teammate: "alpha", message: "dump everything" }, toolCtx());
    expect(result.content.length).toBeLessThanOrEqual(TEAMMATE_REPLY_CAP + 200);
    expect(result.content.startsWith("x".repeat(100))).toBe(true);
    expect(result.content).toMatch(/truncated/i);
  });

  it("empty (but successful) replies yield an explicit placeholder", async () => {
    const port = fakePort(async () => ({ ok: true, reply: "   " }));
    const tool = createSendMessageTool({ sendToTeammate: port });
    const result = await tool.execute({ teammate: "alpha", message: "hi" }, toolCtx());
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe(TEAMMATE_EMPTY_REPLY);
  });

  it("execute self-guards args (validateArgs narrowing never crosses the boundary)", async () => {
    const port = fakePort(async () => ({ ok: true, reply: "never" }));
    const tool = createSendMessageTool({ sendToTeammate: port });
    const missing = await tool.execute({ teammate: "", message: "hi" }, toolCtx());
    expect(missing.isError).toBe(true);
    expect(missing.content).toMatch(/teammate/);
    expect(port.calls).toHaveLength(0);
  });

  it("the unavailable port answers every send with the no-teammates error", async () => {
    const tool = createSendMessageTool({ sendToTeammate: unavailableTeammatePort });
    const result = await tool.execute({ teammate: "alpha", message: "hi" }, toolCtx());
    expect(result.isError).toBe(true);
    expect(result.content).toBe(NO_TEAMMATES_ERROR);
    expect(NO_TEAMMATES_ERROR).toMatch(/no named teammates/i);
  });
});

describe("peer-authority envelope", () => {
  it("anchors: peer agent provenance, peer authority, no permission lift, reply-as-tool-result", () => {
    expect(TEAMMATE_MESSAGE_ENVELOPE).toMatch(/peer agent/i);
    expect(TEAMMATE_MESSAGE_ENVELOPE).toMatch(/not from the human user/i);
    expect(TEAMMATE_MESSAGE_ENVELOPE).toMatch(/peer authority/i);
    expect(TEAMMATE_MESSAGE_ENVELOPE).toMatch(/permission/i);
    expect(TEAMMATE_MESSAGE_ENVELOPE).toMatch(/returned to the sending agent/i);
    expect(TEAMMATE_MESSAGE_ENVELOPE).toMatch(/tool call/i);
  });

  it("envelope is 2-4 sentences of English (LLM-facing)", () => {
    expect(TEAMMATE_MESSAGE_ENVELOPE).toMatch(/^[A-Z]/);
    expect(TEAMMATE_MESSAGE_ENVELOPE).toMatch(/\.$/);
    const sentences = TEAMMATE_MESSAGE_ENVELOPE.split(/(?<=\.)\s+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
    for (const word of TEAMMATE_MESSAGE_ENVELOPE.split(/\s+/)) {
      expect(/^[\x20-\x7E]+$/.test(word)).toBe(true); // ASCII-only envelope text
    }
  });

  it("buildTeammateTurn puts the envelope above the raw message", () => {
    const turn = buildTeammateTurn("please review the parser");
    expect(turn.startsWith(TEAMMATE_MESSAGE_ENVELOPE)).toBe(true);
    expect(turn.endsWith("please review the parser")).toBe(true);
    expect(turn).toBe(`${TEAMMATE_MESSAGE_ENVELOPE}\n\nplease review the parser`);
  });
});

describe("team plugin factory", () => {
  it("registers send_message on a real kernel Context through the persistence gate", async () => {
    const port = fakePort(async () => ({ ok: true, reply: "pong" }));
    const plugin = createTeamPlugin({ sendToTeammate: port });
    expect(plugin.name).toBe("team");
    const ctx = new Context();
    await ctx.plugin(ToolsPlugin);
    await ctx.plugin(plugin);
    const registered = ctx.tools.get(SEND_MESSAGE_TOOL_NAME);
    expect(registered?.name).toBe("send_message");
    expect(registered?.sideEffect).toBe("delegated");
    const result = await registered!.execute({ teammate: "alpha", message: "ping" }, toolCtx());
    expect(result.content).toBe("pong");
  });

  it("distribution default export is the factory itself", () => {
    expect(teamDefault).toBe(createTeamPlugin);
  });
});
