import { describe, expect, it } from "vitest";
import { reduceSessionActivity, sessionActivityStatus, type SessionActivityStatus } from "./sessionActivityProjection";

describe("canonical session activity projection", () => {
  it("provides one five-state source with permission taking priority over running", () => {
    let state = new Map<string, SessionActivityStatus>();
    state = reduceSessionActivity(state, { type: "started", sessionId: "s1" });
    state = reduceSessionActivity(state, { type: "permission", sessionId: "s1" });
    expect(sessionActivityStatus(state, "s1")).toBe("waiting-permission");
    state = reduceSessionActivity(state, { type: "done", sessionId: "s1" });
    expect(sessionActivityStatus(state, "s1")).toBe("idle");
    expect(sessionActivityStatus(state, "s1", true)).toBe("archived");
  });
});
