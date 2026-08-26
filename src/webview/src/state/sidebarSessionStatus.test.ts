import { describe, expect, it } from "vitest";
import { reduceSidebarSessionStatuses } from "./sidebarSessionStatus";

describe("sidebar session status reducer", () => {
  it("marks a session running before a first stream event", () => {
    expect(reduceSidebarSessionStatuses(new Map(), { type: "started", sessionId: "s1" })).toEqual(new Map([["s1", "running"]]));
  });

  it("replaces running with static waiting permission", () => {
    const running = new Map([["s1", "running"]] as const);
    expect(reduceSidebarSessionStatuses(running, { type: "permission", sessionId: "s1" })).toEqual(new Map([["s1", "waiting-permission"]]));
  });

  it("clears done and retains a static failed marker for errors", () => {
    const running = new Map([["s1", "running"], ["s2", "running"]] as const);
    expect(reduceSidebarSessionStatuses(running, { type: "done", sessionId: "s1" })).toEqual(new Map([["s2", "running"]]));
    expect(reduceSidebarSessionStatuses(running, { type: "error", sessionId: "s2" })).toEqual(new Map([["s1", "running"], ["s2", "failed"]]));
  });
});
