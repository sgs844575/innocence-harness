// 端到端（Node 真子进程）：一个最小夹具语言服务器（initialize →
// didOpen 回发 publishDiagnostics，含对 marker 文本的一条 error）验证
// 客户端握手、诊断通道与优雅停机；spawn 用 process.execPath 保证可移植
// （plugin-mcp portable-process 测试同法）。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LspClient } from "../src/client";
import { createLspManager, normalizeServerDescriptor } from "../src/manager";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 夹具服务器脚本：initialize 确认能力；didOpen 时文本含 "boom" 即回发
 *  一条 error 诊断（range 第 1 行），否则回发空快照；shutdown/exit 正常。 */
const FIXTURE_SERVER = `
const chunks = [];
let buffer = Buffer.alloc(0);
const write = (message) => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(Buffer.concat([Buffer.from("Content-Length: " + body.length + "\\r\\n\\r\\n", "ascii"), body]));
};
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const at = buffer.indexOf("\\r\\n\\r\\n", 0, "ascii");
    if (at < 0) break;
    const header = buffer.subarray(0, at).toString("ascii");
    const length = Number(/Content-Length:\\s*(\\d+)/i.exec(header)[1]);
    const start = at + 4;
    if (buffer.length < start + length) break;
    const message = JSON.parse(buffer.subarray(start, start + length).toString("utf8"));
    buffer = buffer.subarray(start + length);
    if (message.method === "initialize") {
      write({ jsonrpc: "2.0", id: message.id, result: { capabilities: { textDocumentSync: 1 } } });
    } else if (message.method === "textDocument/didOpen") {
      const document = message.params.textDocument;
      const diagnostics = document.text.includes("boom")
        ? [{ range: { start: { line: 0, character: 0 } }, severity: 1, code: 1, message: "fixture error: boom found", source: "fixture-lsp" }]
        : [];
      write({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: document.uri, diagnostics } });
    } else if (message.method === "shutdown") {
      write({ jsonrpc: "2.0", id: message.id, result: null });
    } else if (message.method === "exit") {
      process.exit(0);
    } else if (message.id !== undefined) {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "no " + message.method } });
    }
  }
});
`;

function fixtureServerCommand(): { command: string; args: string[] } {
  const dir = mkdtempSync(path.join(tmpdir(), "lsp-fixture-"));
  scratch.push(dir);
  const file = path.join(dir, "fixture-server.cjs");
  writeFileSync(file, FIXTURE_SERVER, "utf8");
  return { command: process.execPath, args: [file] };
}

describe("LspClient (real fixture server)", () => {
  it("handshakes, publishes diagnostics for didOpen, and shuts down cleanly", async () => {
    const { command, args } = fixtureServerCommand();
    const notifications: Array<{ method: string; params: unknown }> = [];
    const client = new LspClient({ command, args }, { onNotification: (method, params) => notifications.push({ method, params }) });
    const root = mkdtempSync(path.join(tmpdir(), "lsp-root-"));
    scratch.push(root);
    await client.start({ workspaceRoot: root });
    expect(client.serverCapabilities).toMatchObject({ textDocumentSync: 1 });
    client.didOpen("file:///a.ts", "typescript", "const x: number = boom;");
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (notifications.some((entry) => entry.method === "textDocument/publishDiagnostics")) resolve();
        else setTimeout(tick, 10);
      };
      tick();
    });
    const publish = notifications.find((entry) => entry.method === "textDocument/publishDiagnostics");
    expect(publish?.params).toMatchObject({
      uri: "file:///a.ts",
      diagnostics: [{ severity: 1, message: "fixture error: boom found" }],
    });
    await client.dispose();
    await client.dispose();
    expect(client.isExited).toBe(true);
  });

  it("rejects requests after dispose and surfaces start failures", async () => {
    const client = new LspClient({ command: "definitely-not-a-real-binary" });
    await expect(client.start({ workspaceRoot: tmpdir() })).rejects.toThrow();
    await client.dispose().catch(() => {});
    await expect(client.request("anything")).rejects.toThrow();
  });
});

describe("normalizeServerDescriptor", () => {
  it("normalizes ids, commands, args, env and dot-suffixed extensions", () => {
    expect(normalizeServerDescriptor({
      id: "ts", command: " node-langserver ", args: ["--stdio", 1], env: { A: "b", bad: 2 }, extensions: ["ts", ".TSX"],
    })).toEqual({ id: "ts", command: "node-langserver", args: ["--stdio"], env: { A: "b" }, extensions: [".ts", ".tsx"] });
  });

  it("rejects malformed shapes", () => {
    expect(normalizeServerDescriptor(undefined)).toBeUndefined();
    expect(normalizeServerDescriptor({ id: "a b", command: "x", extensions: [".ts"] })).toBeUndefined();
    expect(normalizeServerDescriptor({ id: "a", command: "", extensions: [".ts"] })).toBeUndefined();
    expect(normalizeServerDescriptor({ id: "a", command: "x", extensions: [] })).toBeUndefined();
  });
});

describe("createLspManager (real fixture server)", () => {
  it("routes focusFile by extension and settles the first diagnostics snapshot", async () => {
    const { command, args } = fixtureServerCommand();
    const root = mkdtempSync(path.join(tmpdir(), "lsp-mgr-"));
    scratch.push(root);
    writeFileSync(path.join(root, "bad.ts"), "const boom = 1;", "utf8");
    writeFileSync(path.join(root, "fine.ts"), "const fine = 1;", "utf8");
    writeFileSync(path.join(root, "ignored.md"), "boom", "utf8");
    const updates: string[] = [];
    const manager = createLspManager({
      log: () => {},
      onDiagnostics: (_root, notes) => updates.push(notes.map((note) => note.message).join("|")),
    });
    await manager.ensureRoot(root, [{ id: "fixture", command, args, extensions: [".ts"] }]);
    const bad = await manager.focusFile(root, "bad.ts");
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ severity: "error", line: 1, column: 1, code: 1, source: "fixture-lsp" });
    const fine = await manager.focusFile(root, "fine.ts");
    expect(fine).toEqual([]);
    // 未承接的扩展名：无会话路由，空结果且不读取。
    expect(await manager.focusFile(root, "ignored.md")).toEqual([]);
    expect(manager.diagnosticsFor(root, "fine.ts")).toEqual([]);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    await manager.disposeAll();
  });

  it("skips a server that fails to start and keeps the manager usable", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lsp-mgr-dead-"));
    scratch.push(root);
    const logs: string[] = [];
    const manager = createLspManager({ log: (level, message) => logs.push(`${level}:${message}`) });
    await manager.ensureRoot(root, [{ id: "dead", command: "definitely-not-a-real-binary", extensions: [".ts"] }]);
    expect(await manager.focusFile(root, "a.ts")).toEqual([]);
    expect(logs.some((line) => line.startsWith("warn:"))).toBe(true);
    await manager.disposeAll();
  });
});
