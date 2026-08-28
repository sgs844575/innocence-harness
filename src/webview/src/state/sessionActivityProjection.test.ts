import { describe, expect, it } from "vitest";
import { reduceSessionActivity, sessionActivityStatus, reduceSubagentLifecycle, subagentKey, type SessionActivityStatus } from "./sessionActivityProjection";
import type { SubagentLifecycleEvent } from "../../../shared/ipc";

describe("canonical session activity projection", () => {
  it("indexes child lifecycle by parent session and child id while appending real deltas", () => {
    const started: SubagentLifecycleEvent = { childId: "c1", parentSessionId: "p1", description: "查找", status: "started" };
    const running: SubagentLifecycleEvent = { ...started, status: "running", delta: "第一段" };
    const completed: SubagentLifecycleEvent = { ...started, status: "completed", final: "最终" };
    let state = reduceSubagentLifecycle(new Map(), started);
    state = reduceSubagentLifecycle(state, running);
    state = reduceSubagentLifecycle(state, completed);
    expect(state.get(subagentKey("p1", "c1"))).toMatchObject({ status: "completed", text: "最终" });
  });
  it("provides one five-state source with permission taking priority over running", () => {
    let state = new Map<string, SessionActivityStatus>();
    state = reduceSessionActivity(state, { type: "started", sessionId: "s1" });
    state = reduceSessionActivity(state, { type: "permission", sessionId: "s1" });
    expect(sessionActivityStatus(state, "s1")).toBe("waiting-permission");
    state = reduceSessionActivity(state, { type: "permission-resolved", sessionId: "s1", decision: "allow" });
    expect(sessionActivityStatus(state, "s1")).toBe("running");
    state = reduceSessionActivity(state, { type: "permission", sessionId: "s1" });
    state = reduceSessionActivity(state, { type: "permission-resolved", sessionId: "s1", decision: "deny" });
    expect(sessionActivityStatus(state, "s1")).toBe("failed");
    expect(sessionActivityStatus(state, "s1", true)).toBe("archived");
  });
});
