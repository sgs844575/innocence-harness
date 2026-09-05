import { describe, expect, it, vi } from "vitest";
import { observeToolActivity, createExecutionScope, type ToolContext } from "../src";

function context(signal = new AbortController().signal): ToolContext {
  return { signal, scope: createExecutionScope("computer_click"), workspaceRoot: ".", log: vi.fn() };
}

describe("tool activity lifecycle", () => {
  it("waits for presentation before executing, then settles with the actual result", async () => {
    let ready!: () => void;
    const finish = vi.fn();
    const begin = vi.fn(() => new Promise<typeof finish>((resolve) => { ready = () => resolve(finish); }));
    const execute = vi.fn(async () => ({ content: "done" }));
    const running = observeToolActivity({ begin }, "computer_click", context(), execute);
    expect(execute).not.toHaveBeenCalled();
    ready();
    expect(await running).toEqual({ content: "done" });
    expect(finish).toHaveBeenCalledExactlyOnceWith("success");
    expect(begin.mock.calls[0]).toHaveLength(1);
  });
  it("settles returned failures and thrown diagnostics without replacing them", async () => {
    const finish = vi.fn();
    await observeToolActivity({ begin: () => finish }, "action", context(), async () => ({ content: "failed", isError: true }));
    expect(finish).toHaveBeenLastCalledWith("error");
    const failure = new Error("native failure");
    await expect(observeToolActivity({ begin: () => finish }, "action", context(), async () => { throw failure; })).rejects.toBe(failure);
    expect(finish).toHaveBeenLastCalledWith("error");
  });
  it("skips execution if cancelled while the surface is opening", async () => {
    const abort = new AbortController();
    const finish = vi.fn();
    const execute = vi.fn();
    await expect(observeToolActivity({ begin: () => { abort.abort(); return finish; } }, "action", context(abort.signal), execute)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledExactlyOnceWith("cancelled");
  });
  it("keeps tools usable when an optional presentation fails", async () => {
    const ctx = context();
    const result = { content: "done" };
    expect(await observeToolActivity({ begin: () => { throw new Error("surface unavailable"); } }, "action", ctx, async () => result)).toBe(result);
    expect(ctx.log).toHaveBeenCalledWith("warn", expect.any(String));
  });
});
