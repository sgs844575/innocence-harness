import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import {
  INSTRUCTION_FILE_CANDIDATES,
  buildEnvironmentEnvelope,
  buildInstructionEnvelope,
  capInstructionContent,
  createInstructionsPlugin,
  describeCommandShell,
  osLabel,
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
const partsOf = (m: { parts: Array<{ type: string; text?: string }> }) => m.parts.map((p) => (p as { text: string }).text);

function processorsOf(
  root: () => string | undefined,
  isContinuation?: () => boolean,
  shell?: () => { file: string; args: readonly string[] } | undefined,
): MessageProcessor[] {
  const plugin = createInstructionsPlugin({
    getWorkspaceRoot: root,
    isContinuationSession: isContinuation,
    getCommandShell: shell,
    // 固定时钟/平台缝：断言可复现。
    now: () => new Date("2026-09-23T14:05:33"),
    platform: "win32",
  });
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

describe("environment envelope", () => {
  it("carries time with weekday and UTC offset, time zone, OS, and the shell invocation", () => {
    const envelope = buildEnvironmentEnvelope(
      new Date("2026-09-23T14:05:33+08:00"),
      "win32",
      { file: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["--login", "-c"] },
    );
    expect(envelope.startsWith("<system-reminder>\nSession environment")).toBe(true);
    expect(envelope).toContain("2026-09-23 14:05:33 (Wednesday)");
    expect(envelope).toContain("UTC+08:00");
    expect(envelope).toContain("Operating system: Windows (win32)");
    expect(envelope).toContain('"C:\\Program Files\\Git\\bin\\bash.exe" --login -c <command>');
    expect(envelope).toContain("bash syntax (POSIX-compatible)");
    expect(envelope).toContain("Write shell commands for that shell only.");
    expect(envelope).toContain("Time zone: ");
    expect(envelope.endsWith("\n</system-reminder>")).toBe(true);
  });

  it("falls back to the platform-default line without a shell template", () => {
    const envelope = buildEnvironmentEnvelope(new Date("2026-09-23T14:05:33Z"), "linux", undefined);
    expect(envelope).toContain("Operating system: Linux (linux)");
    expect(envelope).toContain("platform default shell expansion");
  });

  it("maps platforms and shell executables to labels", () => {
    expect(osLabel("win32")).toBe("Windows");
    expect(osLabel("darwin")).toBe("macOS");
    expect(osLabel("linux")).toBe("Linux");
    expect(describeCommandShell({ file: "C:\\Windows\\system32\\cmd.exe", args: ["/d", "/s", "/c"] })).toContain("cmd.exe syntax");
    expect(describeCommandShell({ file: "powershell.exe", args: ["-NoProfile", "-Command"] })).toContain("PowerShell syntax");
    expect(describeCommandShell({ file: "wsl.exe", args: ["-e", "bash", "-lc"] })).toContain("WSL");
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

  it("injects the environment envelope FIRST, then the instruction file, on the first turn only", async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, "AGENT.md"), "build with npm test", "utf8");
    const [processor] = processorsOf(() => root, undefined, () => ({ file: "bash.exe", args: ["-c"] }));

    const first = await processor.process(makeMessage("你好"), makeContext());
    const parts = partsOf(first);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("你好");
    expect(parts[1]).toContain("Session environment");
    expect(parts[1]).toContain("Command shell (used by the Bash tool)");
    expect(parts[2]).toContain("build with npm test");
    expect(parts[2]).toContain("Workspace instructions loaded from AGENT.md");

    const second = await processor.process(makeMessage("继续"), makeContext());
    expect(partsOf(second)).toEqual(["继续"]);
  });

  it("injects the environment envelope even without a workspace root or instruction file", async () => {
    const [noRoot] = processorsOf(() => undefined);
    const parts = partsOf(await noRoot.process(makeMessage("hi"), makeContext()));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("hi");
    expect(parts[1]).toContain("Session environment");
    expect(parts[1]).not.toContain("Workspace instructions loaded");

    const empty = await tmpRoot();
    const [noFile] = processorsOf(() => empty);
    const parts2 = partsOf(await noFile.process(makeMessage("hi"), makeContext()));
    expect(parts2).toHaveLength(2);
    expect(parts2[1]).toContain("Session environment");
  });

  it("skips continuation sessions entirely (stored first turn already carries the envelopes)", async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, "AGENT.md"), "rules", "utf8");
    const [processor] = processorsOf(() => root, () => true);
    const message = await processor.process(makeMessage("继续"), makeContext());
    expect(partsOf(message)).toEqual(["继续"]);
  });

  it("consumes the attempt even when skipped (a later file waits for the next session)", async () => {
    const root = await tmpRoot();
    const [processor] = processorsOf(() => root);
    await processor.process(makeMessage("first"), makeContext());
    await fs.writeFile(path.join(root, "AGENT.md"), "late rules", "utf8");
    const second = await processor.process(makeMessage("second"), makeContext());
    expect(partsOf(second)).toEqual(["second"]);
  });
});
