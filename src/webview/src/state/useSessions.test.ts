import { describe, expect, it } from "vitest";
import { withoutAuxSessions } from "./useSessions";
import type { Session } from "../../../shared/ipc";

const session = (id: string, aux?: boolean): Session => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  messageCount: 0,
  ...(aux === true ? { aux: true } : {}),
});

describe("withoutAuxSessions", () => {
  it("过滤 dock 辅助对话会话，保留普通会话", () => {
    expect(withoutAuxSessions([session("a"), session("b", true), session("c")])).toEqual([session("a"), session("c")]);
  });

  it("全普通会话原样返回", () => {
    const list = [session("a"), session("b")];
    expect(withoutAuxSessions(list)).toEqual(list);
  });
});
