import { Context } from "@innocenceharness/kernel";
import { HmrPlugin } from "../src";
import { afterEach, describe, expect, it } from "vitest";

describe("kernel hmr service", () => {
  const contexts: Context[] = [];
  afterEach(async () => { await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose())); });

  async function setup() {
    const ctx = new Context();
    contexts.push(ctx);
    const fiber = await ctx.plugin(HmrPlugin);
    return { ctx, fiber };
  }

  it("registers and restarts a target", async () => {
    const { ctx } = await setup();
    let count = 0;
    const off = ctx.hmr.watch("a", async () => { count += 1; });
    await ctx.hmr.restart("a");
    expect(count).toBe(1);
    off();
    await expect(ctx.hmr.restart("a")).rejects.toThrow(/not found/);
  });

  it("keeps a failed restart registered", async () => {
    const { ctx } = await setup();
    let attempts = 0;
    ctx.hmr.watch("a", async () => {
      attempts += 1;
      throw new Error("restart failed");
    });
    await expect(ctx.hmr.restart("a")).rejects.toThrow("restart failed");
    await expect(ctx.hmr.restart("a")).rejects.toThrow("restart failed");
    expect(attempts).toBe(2);
  });

  it("stops targets idempotently and isolates ids", async () => {
    const { ctx, fiber } = await setup();
    let count = 0;
    ctx.hmr.watch("a", async () => { count += 1; });
    ctx.hmr.watch("b", async () => { count += 10; });
    await ctx.hmr.stop("a");
    expect(fiber.getEffects().filter(({ label }) => label === "hmr a")).toHaveLength(0);
    await ctx.hmr.stop("a");
    await expect(ctx.hmr.restart("a")).rejects.toThrow();
    await ctx.hmr.restart("b");
    expect(count).toBe(10);
  });

  it("removes all targets with the owning fiber", async () => {
    const { ctx, fiber } = await setup();
    ctx.hmr.watch("a", async () => {});
    await fiber.dispose();
    expect((ctx as { hmr?: unknown }).hmr).toBeUndefined();
  });
});
