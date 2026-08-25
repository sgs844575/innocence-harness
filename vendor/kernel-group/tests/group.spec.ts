import { Context } from "@innocenceharness/kernel";
import { Loader } from "@innocenceharness/kernel-loader";
import { afterEach, describe, expect, it } from "vitest";
import { createGroupPlugin } from "../src";

describe("kernel group", () => {
  const contexts: Context[] = [];
  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()));
  });

  async function withLoader() {
    const ctx = new Context();
    contexts.push(ctx);
    await ctx.plugin(Loader);
    return ctx;
  }

  it("starts entries below the group subtree with composite ids", async () => {
    const ctx = await withLoader();
    const seen: string[] = [];
    ctx.loader.internal = {
      version: "test",
      import: async (name) => ({ default: { name, apply() { seen.push(name); } } }),
    };
    ctx.loader.builtins.group = createGroupPlugin({
      id: "basic",
      entries: [{ id: "one" }, { id: "two", name: "two" }],
    });

    await ctx.loader.create({ id: "basic", name: "kernel:group" });
    expect(seen).toEqual(["one", "two"]);
    expect([...ctx.loader.entries()].map((entry) => entry.id)).toContain("basic:one");
  });

  it("does not start disabled group entries", async () => {
    const ctx = await withLoader();
    let imports = 0;
    ctx.loader.internal = { version: "test", import: async () => { imports += 1; return {}; } };
    ctx.loader.builtins.group = createGroupPlugin({
      id: "disabled",
      entries: [{ id: "off", disabled: true }],
    });

    await ctx.loader.create({ id: "disabled", name: "kernel:group" });
    expect(imports).toBe(0);
    expect(ctx.loader.resolve("disabled:off").fiber).toBeUndefined();
  });

  it("rolls back successful and failing member fibers", async () => {
    const ctx = await withLoader();
    let cleaned = 0;
    ctx.loader.internal = {
      version: "test",
      import: async (name) => name === "bad"
        ? { default: { name, apply(context: Context) { context.effect(() => () => { cleaned += 1; }); throw new Error("boom"); } } }
        : { default: { name, apply(context: Context) { context.effect(() => () => { cleaned += 1; }); } } },
    };
    ctx.loader.builtins.group = createGroupPlugin({
      id: "atomic",
      entries: [{ id: "good" }, { id: "bad" }],
    });

    await expect(ctx.loader.create({ id: "atomic", name: "kernel:group" })).rejects.toThrow(/bad|boom/);
    expect(cleaned).toBe(2);
    expect(ctx.loader.resolve("atomic:good").fiber?.uid).toBeNull();
    expect(ctx.loader.resolve("atomic:bad").fiber?.uid).toBeNull();
  });

  it("supports nested groups with composite subtree ids", async () => {
    const ctx = await withLoader();
    ctx.loader.internal = { version: "test", import: async () => ({ default: { apply() {} } }) };
    ctx.loader.builtins.inner = createGroupPlugin({ id: "inner", entries: [{ id: "leaf" }] });
    ctx.loader.builtins.outer = createGroupPlugin({ id: "outer", entries: [{ id: "inner", name: "kernel:inner" }] });

    await ctx.loader.create({ id: "outer", name: "kernel:outer" });
    expect(ctx.loader.resolve("outer:inner:leaf").fiber?.uid).not.toBeNull();
  });

  it("disposes every member when the group fiber is disposed", async () => {
    const ctx = await withLoader();
    let cleaned = 0;
    ctx.loader.internal = {
      version: "test",
      import: async () => ({ default: { apply(context: Context) { context.effect(() => () => { cleaned += 1; }); } } }),
    };
    ctx.loader.builtins.group = createGroupPlugin({ id: "owned", entries: [{ id: "member" }] });

    const group = await ctx.loader.create({ id: "owned", name: "kernel:group" });
    await group.fiber?.dispose();
    expect(cleaned).toBe(1);
    expect(ctx.loader.resolve("owned:member").fiber?.uid).toBeNull();
  });
});
