import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@innocenceharness/kernel";
import { LoggerPlugin } from "@innocenceharness/kernel-logger";
import { ToolsPlugin, createExecutionScope, type ToolContext } from "@innocenceharness/harness-tools";
import { createSessionPlugin, textMessage } from "@innocenceharness/harness-session";
import { createDshCompatPlugin, parsePatchDocument } from "../src";

/** Effect-disposal probe key shared with the fixture modules. */
const DISPOSED_KEY = "__dshCompatDisposed";

let root: string;
let bundleDir: string;

/** The reference-harness function-form fixture: one tool plus a cleanup effect. */
const helloPlugin = `
export const name = "hello-plugin";
export const inject = ["tools"];
export function apply(ctx) {
  ctx.tools.register({
    name: "greet",
    description: "Greet someone by name.",
    parameters: {
      name: { type: "string", required: true, description: "The name to greet" },
      loud: { type: "boolean", required: false, description: "Shout the greeting" },
    },
    output: {
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      const greeting = "Hello, " + args.name + "!";
      return args.loud ? greeting.toUpperCase() : greeting;
    },
  });
  ctx.effect(() => () => {
    globalThis[${JSON.stringify(DISPOSED_KEY)}] = true;
  });
}
`;

/** Object-form fixture (default export with `apply`). */
const objectPlugin = `
export default {
  name: "object-plugin",
  inject: ["tools"],
  apply(ctx) {
    ctx.tools.register({
      name: "ping",
      description: "Ping.",
      parameters: {},
      async execute() {
        return "pong";
      },
    });
  },
};
`;

/** Fixture whose module evaluation throws. */
const boomPlugin = `throw new Error("boom at import");`;

/** Fixture requiring a service the compatibility layer never provides. */
const unmetPlugin = `
export const inject = ["definitely-missing"];
export function apply() {}
`;

/** Fixture whose execute rejects — surfaces as an error tool result. */
const failingToolPlugin = `
export function apply(ctx) {
  ctx.tools.register({
    name: "fails",
    description: "Always fails.",
    parameters: {},
    async execute() {
      throw new Error("kaboom");
    },
  });
}
`;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "dsh-compat-"));
  await writeFile(path.join(root, "hello.mjs"), helloPlugin, "utf8");
  await writeFile(path.join(root, "object.mjs"), objectPlugin, "utf8");
  await writeFile(path.join(root, "boom.mjs"), boomPlugin, "utf8");
  await writeFile(path.join(root, "unmet.mjs"), unmetPlugin, "utf8");
  await writeFile(path.join(root, "failing-tool.mjs"), failingToolPlugin, "utf8");
  await writeFile(
    path.join(root, "cordis.patch.yml"),
    [
      "- insert:",
      "    - id: hello",
      "      name: ./hello.mjs",
      "    - id: object",
      "      name: ./object.mjs",
      "- remove:",
      "    - object",
      "- name: ./boom.mjs",
      "- name: ./unmet.mjs",
      "- name: ./failing-tool.mjs",
      "",
    ].join("\n"),
    "utf8",
  );
  // Bundle layout: a subdirectory whose package.json declares the patch file.
  bundleDir = await mkdtemp(path.join(tmpdir(), "dsh-bundle-"));
  const pkgDir = path.join(bundleDir, "bundled-tool");
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "dsh-bundled-tool",
      version: "0.1.0",
      type: "module",
      main: "index.mjs",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    }),
    "utf8",
  );
  await writeFile(
    path.join(pkgDir, "cordis.patch.yml"),
    ["- insert:", "    - id: bundled", "      name: ./index.mjs", ""].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(pkgDir, "index.mjs"),
    `
export function apply(ctx) {
  ctx.tools.register({
    name: "bundled",
    parameters: { value: { type: "number", required: true } },
    output: { render: (_args, value) => [{ type: "text", text: "n=" + value }] },
    async execute(args) {
      return args.value;
    },
  });
}
`,
    "utf8",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(bundleDir, { recursive: true, force: true });
});

/** Mounts the compat plugin on a bare kernel context (logger + tools spines). */
async function mount(roots: string[], withSession = false): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(LoggerPlugin);
  await ctx.plugin(ToolsPlugin);
  if (withSession) {
    await ctx.plugin(
      createSessionPlugin({
        provider: { id: "bare", async *chat(): AsyncIterable<never> {} },
        sessionId: "sess-bare",
      }),
    );
  }
  await ctx.plugin(createDshCompatPlugin({ roots }));
  return ctx;
}

function toolContext(): ToolContext {
  return {
    workspaceRoot: "D:/tmp",
    signal: new AbortController().signal,
    log: () => {},
    scope: createExecutionScope("test-invocation"),
  };
}

/** Disposes one context and clears the cross-test effect-disposal probe. */
async function disposeQuietly(ctx: Context): Promise<void> {
  await ctx.fiber.dispose();
  delete (globalThis as Record<string, unknown>)[DISPOSED_KEY];
}

describe("parsePatchDocument", () => {
  it("normalizes insert-op rows, plain rows, and string rows", () => {
    const parsed = parsePatchDocument(
      ["- insert:", "    - id: a", "      name: ./a.mjs", "      config:", "        x: 1", "- name: ./b.mjs", "- './c.mjs'", ""].join("\n"),
    );
    expect(parsed.entries).toEqual([
      { id: "a", name: "./a.mjs", config: { x: 1 } },
      { name: "./b.mjs" },
      { name: "./c.mjs" },
    ]);
    expect(parsed.removals).toEqual([]);
  });

  it("collects remove ops by id", () => {
    const parsed = parsePatchDocument(["- remove:", "    - stale", ""].join("\n"));
    expect(parsed.removals).toEqual(["id:stale"]);
  });

  it("rejects non-list documents and reports unsupported rows", () => {
    expect(() => parsePatchDocument("name: single\n")).toThrow("must be a YAML list");
    const parsed = parsePatchDocument(["- 42", "- edit:", "    - id: x", ""].join("\n"));
    expect(parsed.entries).toEqual([]);
    expect(parsed.problems).toHaveLength(2);
  });
});

describe("dsh compatibility plugin", () => {
  it("loads patch rows, drops removed ones, and maps tools", async () => {
    const ctx = await mount([root]);
    try {
      const greet = ctx.tools.get("dsh__hello__greet");
      expect(greet).toBeDefined();
      // The object-form entry was removed by the patch — its tool stays absent.
      expect(ctx.tools.get("dsh__object__ping")).toBeUndefined();
      // The unmet-inject entry never loads.
      expect(ctx.tools.get("dsh__unmet__x")).toBeUndefined();

      expect(greet!.parameters).toEqual({
        type: "object",
        properties: {
          name: { type: "string", description: "The name to greet" },
          loud: { type: "boolean", description: "Shout the greeting" },
        },
        required: ["name"],
      });
      expect(greet!.permissionResource({}, toolContext())).toEqual({
        action: "call",
        kind: "dsh",
        scope: "hello/greet",
      });
      const result = await greet!.execute({ name: "Ada" }, toolContext());
      expect(result).toEqual({ content: "Hello, Ada!" });

      const failing = ctx.tools.get("dsh__failing-tool__fails")!;
      const error = await failing.execute({}, toolContext());
      expect(error.isError).toBe(true);
      expect(error.content).toContain("kaboom");
    } finally {
      await disposeQuietly(ctx);
    }
  });

  it("discovers bundle layouts under a root", async () => {
    const ctx = await mount([bundleDir]);
    try {
      const bundled = ctx.tools.get("dsh__bundled__bundled");
      expect(bundled).toBeDefined();
      const result = await bundled!.execute({ value: 7 }, toolContext());
      expect(result).toEqual({ content: "n=7" });
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it("isolates one bad module without blocking the others", async () => {
    const ctx = await mount([root], true);
    try {
      expect(ctx.tools.get("dsh__hello__greet")).toBeDefined();
      const input = textMessage("user", "hi");
      const processed = await ctx.session.processUserInput(input);
      const note = processed.parts.find(
        (part) => part.type === "text" && "text" in part && String(part.text).includes("could not be loaded"),
      );
      expect(note).toBeDefined();
      const text = String((note as { text: string }).text);
      expect(text).toContain("boom");
      expect(text).toContain("definitely-missing");
      expect(text).toContain("<system-reminder>");
      // Exactly one note: the second user input carries none.
      const second = await ctx.session.processUserInput(textMessage("user", "again"));
      expect(
        second.parts.filter((part) => part.type === "text" && "text" in part && String(part.text).includes("could not be loaded")),
      ).toHaveLength(0);
    } finally {
      await disposeQuietly(ctx);
    }
  });

  it("releases shim effects when the plugin unloads", async () => {
    const ctx = await mount([root]);
    expect((globalThis as Record<string, unknown>)[DISPOSED_KEY]).toBeUndefined();
    await ctx.fiber.dispose();
    expect((globalThis as Record<string, unknown>)[DISPOSED_KEY]).toBe(true);
    delete (globalThis as Record<string, unknown>)[DISPOSED_KEY];
  });

  it("scans a missing root to nothing", async () => {
    const ctx = await mount([path.join(tmpdir(), "dsh-compat-missing-root")]);
    try {
      expect(ctx.tools.specs().every((spec) => !spec.name.startsWith("dsh__missing"))).toBe(true);
    } finally {
      await ctx.fiber.dispose();
    }
  });
});
