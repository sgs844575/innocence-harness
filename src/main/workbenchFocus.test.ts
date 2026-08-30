import { describe, expect, it } from "vitest";
import { getWorkbenchFocus, setWorkbenchFocus } from "./workbenchFocus";

describe("workbench focus state (S4)", () => {
  it("keeps a single slot: set overwrites, undefined clears", () => {
    setWorkbenchFocus({ sessionId: "s1", file: "src/a.ts", line: 12 });
    expect(getWorkbenchFocus()).toEqual({ sessionId: "s1", file: "src/a.ts", line: 12 });
    setWorkbenchFocus({ sessionId: "s2", file: "src/b.ts" });
    expect(getWorkbenchFocus()).toEqual({ sessionId: "s2", file: "src/b.ts" });
    setWorkbenchFocus(undefined);
    expect(getWorkbenchFocus()).toBeUndefined();
  });
});
