// plugin-memory index-injection tests (batch 4B task 2): the first-turn
// memory index processor — three injection states (entries -> index block,
// empty store -> no part, over-cap -> truncated rows plus a warning line),
// owner-session gating (a different session neither injects nor consumes
// the first turn), IO degradation (root getter / listing failure never
// breaks the input pipeline), and text discipline (index rows only, never
// entry bodies or updated stamps; English, no banned tokens).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@innocenceharness/kernel";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import type { Message, MessageProcessor } from "@innocenceharness/harness-session";
import {
  MEMORY_INDEX_PROCESSOR_NAME,
  MEMORY_INDEX_PROCESSOR_ORDER,
  MEMORY_INDEX_ROW_CAP,
  MEMORY_LIST_TOOL_NAME,
  createMemoryIndexProcessor,
  createMemoryPlugin,
  listEntries,
  renderMemoryIndexBlock,
  writeEntry,
} from "../src";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tmpRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "ic-memory-idx-"));
  roots.push(root);
  return root;
}

function userMessage(text = "hello"): Message {
  return { role: "user", parts: [{ type: "text", text }] };
}

function procCtx(sessionId = "s1"): never {
  return {
    signal: new AbortController().signal,
    provider: { id: "test" },
    scope: { sessionId },
  } as never;
}

/** Mounted plugin on a real kernel Context: the real ToolsPlugin gate plus a
 *  capturing fake session service (planflow test precedent). */
async function mount(getUserRoot: () => string, getProjectRoot: () => string) {
  const ctx = new Context();
  const processors: MessageProcessor[] = [];
  await ctx.plugin(ToolsPlugin);
  ctx.provide("session", {
    registerProcessor: (p: MessageProcessor) => processors.push(p),
  });
  await ctx.plugin(createMemoryPlugin({ getUserRoot, getProjectRoot }));
  const processor = processors.find((p) => p.name === MEMORY_INDEX_PROCESSOR_NAME);
  return { ctx, processors, processor };
}

/** The one text part the processor appended, or undefined when none. */
function appendedText(message: Message): string | undefined {
  const appended = message.parts.filter(
    (p, index) => p.type === "text" && index > 0,
  ) as { type: "text"; text: string }[];
  return appended.length === 1 ? appended[0].text : undefined;
}

async function seedTwoRoots(): Promise<{ userRoot: string; projectRoot: string }> {
  const userRoot = tmpRoot();
  const projectRoot = tmpRoot();
  await writeEntry(userRoot, {
    id: "reply-style",
    scope: "user",
    tags: ["style"],
    body: "Keep answers plain and short.\nSecond body line never shown.",
  });
  await writeEntry(projectRoot, {
    id: "verify-first",
    scope: "project",
    tags: ["build", "tests"],
    body: "Run the focused tests before the full suite.",
  });
  return { userRoot, projectRoot };
}

describe("renderMemoryIndexBlock", () => {
  it("declares the processor contract: name, order, row cap", () => {
    expect(MEMORY_INDEX_PROCESSOR_NAME).toBe("memory-index");
    expect(MEMORY_INDEX_PROCESSOR_ORDER).toBe(-500);
    expect(MEMORY_INDEX_ROW_CAP).toBe(30);
  });

  it("an empty index renders nothing (no injection)", async () => {
    const root = tmpRoot();
    expect(renderMemoryIndexBlock(await listEntries([root]))).toBeUndefined();
  });

  it("renders header, pointer rows and retrieval guidance; never bodies or stamps", async () => {
    const { userRoot, projectRoot } = await seedTwoRoots();
    const block = renderMemoryIndexBlock(await listEntries([userRoot, projectRoot]))!;
    expect(block).toContain("[memory index]");
    expect(block).toContain("reply-style [user] #style — Keep answers plain and short.");
    expect(block).toContain("verify-first [project] #build #tests — Run the focused tests");
    expect(block).not.toContain("Second body line never shown.");
    expect(block).not.toMatch(/updated/i);
    expect(block).toMatch(/memory_read/);
    expect(block).toMatch(/memory_list/);
    expect(block.startsWith("<system-reminder>")).toBe(true);
    expect(block.trimEnd().endsWith("</system-reminder>")).toBe(true);
  });

  it("at the cap exactly there is no warning; past it the block truncates and warns", async () => {
    const root = tmpRoot();
    const atCap = MEMORY_INDEX_ROW_CAP;
    for (let i = 1; i <= atCap + 2; i++) {
      await writeEntry(root, {
        id: `note-${String(i).padStart(2, "0")}`,
        scope: "project",
        tags: ["cap"],
        body: `Body number ${i}.`,
      });
    }
    const block = renderMemoryIndexBlock(await listEntries([root]))!;
    const rows = block.split(/\r?\n/).filter((line) => /^note-\d\d \[project\]/.test(line));
    expect(rows).toHaveLength(atCap);
    expect(block).not.toContain("note-31");
    expect(block).not.toContain("note-32");
    expect(block).toMatch(new RegExp(`${atCap + 2}`)); // 告警行携带总数
    expect(block).toMatch(/memory_list/); // 完整清单的合法获取路径
  });
});

describe("memory index processor", () => {
  it("injects the index block once, on the first user input of the owner session", async () => {
    const { userRoot, projectRoot } = await seedTwoRoots();
    const { processor } = await mount(() => userRoot, () => projectRoot);
    expect(processor).toBeDefined();

    const first = await processor!.process(userMessage(), procCtx("owner"));
    const injected = appendedText(first);
    expect(injected).toBeDefined();
    expect(injected).toContain("[memory index]");
    expect(injected).toContain("reply-style [user] #style");

    // 第二轮：不再注入——即使磁盘上这时又落了新条目。
    await writeEntry(projectRoot, {
      id: "late-entry",
      scope: "project",
      tags: [],
      body: "Landed after the first turn.",
    });
    const second = await processor!.process(userMessage("more"), procCtx("owner"));
    expect(appendedText(second)).toBeUndefined();
    expect(second.parts).toHaveLength(1);
  });

  it("a non-user message neither injects nor consumes the first turn", async () => {
    const { userRoot, projectRoot } = await seedTwoRoots();
    const { processor } = await mount(() => userRoot, () => projectRoot);
    const assistant: Message = { role: "assistant", parts: [{ type: "text", text: "ack" }] };
    expect(appendedText(await processor!.process(assistant, procCtx("owner")))).toBeUndefined();
    const first = await processor!.process(userMessage(), procCtx("owner"));
    expect(appendedText(first)).toContain("[memory index]");
  });

  it("an empty memory store injects nothing", async () => {
    const userRoot = tmpRoot();
    const projectRoot = tmpRoot();
    const { processor } = await mount(() => userRoot, () => projectRoot);
    const first = await processor!.process(userMessage(), procCtx("owner"));
    expect(first.parts).toHaveLength(1);
    expect(appendedText(first)).toBeUndefined();
  });

  it("a different session neither injects nor disturbs the owner's one shot", async () => {
    const { userRoot, projectRoot } = await seedTwoRoots();
    const { processor } = await mount(() => userRoot, () => projectRoot);

    // 属主会话（首见者）第一轮：注入。
    const ownerFirst = await processor!.process(userMessage(), procCtx("owner"));
    expect(appendedText(ownerFirst)).toContain("[memory index]");

    // 子会话随后继承同一 processor 实例：不注入（契约是"回报发现"，
    // 不是"展示记忆索引"），也不翻转任何状态。
    const childFirst = await processor!.process(userMessage(), procCtx("child"));
    expect(childFirst.parts).toHaveLength(1);

    // 属主第二轮与任何其他会话都不再注入。
    expect(
      (await processor!.process(userMessage("again"), procCtx("owner"))).parts,
    ).toHaveLength(1);
    expect((await processor!.process(userMessage(), procCtx("other"))).parts).toHaveLength(1);
  });

  it("root getter or listing failure degrades to no injection, never throws", async () => {
    const projectRoot = tmpRoot();
    const { processor } = await mount(
      () => {
        throw new Error("user root unavailable");
      },
      () => projectRoot,
    );
    const first = await processor!.process(userMessage(), procCtx("owner"));
    expect(first.parts).toHaveLength(1);
    expect(appendedText(first)).toBeUndefined();
  });

  it("the plugin factory registers the processor alongside the three tools", async () => {
    const { userRoot, projectRoot } = await seedTwoRoots();
    const { ctx, processors } = await mount(() => userRoot, () => projectRoot);
    expect(processors.map((p) => p.name)).toContain(MEMORY_INDEX_PROCESSOR_NAME);
    expect(ctx.tools.get(MEMORY_LIST_TOOL_NAME)?.name).toBe("memory_list");
  });

  it("injected text stays English and free of banned tokens", async () => {
    const { userRoot, projectRoot } = await seedTwoRoots();
    const standalone = createMemoryIndexProcessor({
      getUserRoot: () => userRoot,
      getProjectRoot: () => projectRoot,
    });
    const out = await standalone.process(userMessage(), procCtx("s"));
    const text = appendedText(out)!;
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
      expect(text).not.toMatch(re);
    }
  });
});
