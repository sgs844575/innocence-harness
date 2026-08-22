import { Context } from "@innocencecode/kernel";
import { Loader } from "@innocencecode/kernel-loader";
import { afterEach, describe, expect, it } from "vitest";
import { createGroupPlugin } from "../src";

declare module "@innocencecode/kernel" {
  interface Events {}
}

describe("kernel group", () => {
  const contexts: Context[] = [];
  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()));
  });

  it("starts every enabled entry", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await ctx.plugin(Loader);
    const seen: string[] = [];
    ctx.loader.internal = {
      version: "test",
      import: async (name) => ({ default: { name, apply() { seen.push(name); } } }),
    };
    await ctx.plugin(createGroupPlugin({ id: "basic", entries: [{ id: "one", name: "one" }, { id: "two", name: "two" }] }));
    expect(seen).toEqual(["one", "two"]);
    expect([...ctx.loader.entries()].map((entry) => entry.options.id)).toContain("one");
  });

  it("does not start disabled entries", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await ctx.plugin(Loader);
    let imports = 0;
    ctx.loader.internal = { version: "test", import: async () => { imports += 1; return {}; } };
    await ctx.plugin(createGroupPlugin({ id: "disabled", entries: [{ id: "off", name: "off", disabled: true }] }));
    expect(imports).toBe(0);
  });

  it("rolls back entries when a later entry fails", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await ctx.plugin(Loader);
    let cleaned = 0;
    ctx.loader.internal = {
      version: "test",
      import: async (name) => name === "bad"
        ? { default: { name, apply() { throw new Error("boom"); } } }
        : { default: { name, apply(context: Context) { context.effect(() => () => { cleaned += 1; }); } } },
    };
    await expect(ctx.plugin(createGroupPlugin({ id: "atomic", entries: [{ id: "good", name: "good" }, { id: "bad", name: "bad" }] }))).rejects.toThrow(/bad|boom/);
    expect(cleaned).toBe(1);
  });
});
