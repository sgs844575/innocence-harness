import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import {
  INSTRUCTION_FILE_CANDIDATES,
  buildInstructionEnvelope,
  capInstructionContent,
  createInstructionsPlugin,
  readInstructionFile,
} from "../src";

const tmpDirs: string[] = [];
async function tmpRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "instructions-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeMessage(text: string) {
  return { role: "user" as const, parts: [{ type: "text" as const, text }] };
}
function makeContext(sessionId = "s") {
  return {
    provider: { id: "test" },
    signal: new AbortController().signal,
    scope: { sessionId },
  } as never;
}
const textOf = (m: { parts: Array<{ type: string; text?: string }> }) =>
  m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");

function processorsOf(root: () => string | undefined, isContinuation?: () => boolean): MessageProcessor[] {
  const plugin = createInstructionsPlugin({ getWorkspaceRoot: root, isContinuationSession: isContinuation });
  const processors: MessageProcessor[] = [];
  plugin.apply({ session: { registerProcessor: (p: MessageProcessor) => processors.push(p) } } as never);
  return processors;
}

describe("instruction file resolution", () => {
  it("prefers AGENT.md over the case and plural variants", async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, "agents.md"), "plural-lower", "utf8");
    await fs.writeFile(path.join(root, "AGENTS.md"), "plural", "utf8");
    await fs.writeFile(path.join(root, "agent.md"), "singular-lower", "utf8");
    await fs.writeFile(path.join(root, "AGENT.md"), "canonical", "utf8");
    expect(await readInstructionFile(root)).toEqual({ fileName: "AGENT.md", content: "canonical" });
  });

  it("missing or empty files yield null", async () => {
    const root = await tmpRoot();
    expect(await readInstructionFile(root)).toBeNull();
    await fs.writeFile(path.join(root, "AGENT.md"), "   \n", "utf8");
    expect(await readInstructionFile(root)).toBeNull();
  });

  it("candidate order is singular-first", () => {
    expect([...INSTRUCTION_FILE_CANDIDATES]).toEqual(["AGENT.md", "agent.md", "AGENTS.md", "agents.md"]);
  });
});

describe("envelope and cap", () => {
  it("wraps content in the shared reminder envelope shape", () => {
    const envelope = buildInstructionEnvelope("AGENT.md", "RULES");
    expect(envelope.startsWith("<system-reminder>\n")).toBe(true);
    expect(envelope.endsWith("\n</system-reminder>")).toBe(true);
    expect(envelope).toContain("Workspace instructions loaded from AGENT.md");
    expect(envelope).toContain("RULES");
  });

  it("truncates oversized content with a visible note", () => {
    const big = "x".repeat(120 * 1024);
    const capped = capInstructionContent(big, 100 * 1024);
    expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(100 * 1024 + 200);
    expect(capped).toContain("[Truncated:");
  });
});

describe("instructions processor", () => {
  it("registers one parent-only processor named instructions at order 800", () => {
    const processors = processorsOf(() => "");
    expect(processors).toHaveLength(1);
    expect(processors[0].name).toBe("instructions");
    expect(processors[0].order).toBe(800);
    expect(processors[0].inheritToSubagents).toBe(false);
  });

  it("injects the file into the first turn only", async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, "AGENT.md"), "build with npm test", "utf8");
    const [processor] = processorsOf(() => root);

    const first = await processor.process(makeMessage("你好"), makeContext());
    expect(textOf(first)).toContain("你好");
    expect(textOf(first)).toContain("build with npm test");
    expect(textOf(first)).toContain("Workspace instructions loaded from AGENT.md");

    const second = await processor.process(makeMessage("继续"), makeContext());
    expect(textOf(second)).toBe("继续");
  });

  it("skips continuation sessions (stored first turn already carries the envelope)", async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, "AGENT.md"), "rules", "utf8");
    const [processor] = processorsOf(() => root, () => true);
    const message = await processor.process(makeMessage("继续"), makeContext());
    expect(textOf(message)).toBe("继续");
  });

  it("skips without a workspace root or instruction file", async () => {
    const [noRoot] = processorsOf(() => undefined);
    expect(textOf(await noRoot.process(makeMessage("hi"), makeContext()))).toBe("hi");

    const empty = await tmpRoot();
    const [noFile] = processorsOf(() => empty);
    expect(textOf(await noFile.process(makeMessage("hi"), makeContext()))).toBe("hi");
  });

  it("consumes the attempt even when skipped (a later file waits for the next session)", async () => {
    const root = await tmpRoot();
    const [processor] = processorsOf(() => root);
    await processor.process(makeMessage("first"), makeContext());
    await fs.writeFile(path.join(root, "AGENT.md"), "late rules", "utf8");
    const second = await processor.process(makeMessage("second"), makeContext());
    expect(textOf(second)).toBe("second");
  });
});
