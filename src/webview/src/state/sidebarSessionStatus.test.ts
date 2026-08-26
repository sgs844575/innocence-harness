import { describe, expect, it } from "vitest";
import { reduceSessionActivity } from "./sessionActivityProjection";

describe("session activity event protocol", () => {
  it("maps running, permission, done, and error through the canonical reducer", () => {
    const running = reduceSessionActivity(new Map(), { type: "started", sessionId: "s1" });
    expect(running).toEqual(new Map([["s1", "running"]]));
    const waiting = reduceSessionActivity(running, { type: "permission", sessionId: "s1" });
    expect(waiting).toEqual(new Map([["s1", "waiting-permission"]]));
    expect(reduceSessionActivity(waiting, { type: "stream", sessionId: "s1" })).toEqual(waiting);
    expect(reduceSessionActivity(waiting, { type: "done", sessionId: "s1" })).toEqual(new Map([["s1", "idle"]]));
    expect(reduceSessionActivity(running, { type: "error", sessionId: "s1" })).toEqual(new Map([["s1", "failed"]]));
  });
});
