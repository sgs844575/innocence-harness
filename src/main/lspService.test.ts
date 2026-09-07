// 语言服务器宿主面测试（语言服务器波）：settings 声明驱动 + 每根懒装载 +
// 声明签名变化重建。夹具服务器复用 harness-lsp 测试的最小 LSP 形态
// （process.execPath 起真子进程，可移植）。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeLanguageServers, type HarnessSettings } from "@innocenceharness/harness-electron";
import { createLspService } from "./lspService";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FIXTURE_SERVER = `
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
    const length = Number(/Content-Length:\\s*(\\d+)/i.exec(buffer.subarray(0, at).toString("ascii"))[1]);
    const start = at + 4;
    if (buffer.length < start + length) break;
    const message = JSON.parse(buffer.subarray(start, start + length).toString("utf8"));
    buffer = buffer.subarray(start + length);
    if (message.method === "initialize") write({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
    else if (message.method === "textDocument/didOpen") {
      const document = message.params.textDocument;
      const diagnostics = document.text.includes("boom")
        ? [{ range: { start: { line: 2, character: 1 } }, severity: 2, code: "no-boom", message: "boom is forbidden", source: "fixture" }]
        : [];
      write({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: document.uri, diagnostics } });
    } else if (message.method === "shutdown") write({ jsonrpc: "2.0", id: message.id, result: null });
    else if (message.method === "exit") process.exit(0);
    else if (message.id !== undefined) write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "no" } });
  }
});
`;

function fixtureServerFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lsp-host-"));
  scratch.push(dir);
  const file = path.join(dir, "server.cjs");
  writeFileSync(file, FIXTURE_SERVER, "utf8");
  return file;
}

describe("normalizeLanguageServers (settings)", () => {
  it("keeps absent keys absent and drops malformed entries", () => {
    expect(normalizeLanguageServers(undefined)).toBeUndefined();
    expect(normalizeLanguageServers("junk")).toEqual([]);
    expect(normalizeLanguageServers([
      { id: "a", command: " x ", extensions: ["TS", ".tsx"], args: ["--stdio", 3], env: { K: "v", bad: 1 } },
      { id: "b", command: "y" },
      { id: " c ", command: "", extensions: [".md"] },
      "junk",
    ])).toEqual([
      { id: "a", command: "x", args: ["--stdio"], env: { K: "v" }, extensions: [".ts", ".tsx"] },
    ]);
  });
});

describe("createLspService", () => {
  function settingsOf(declarations: unknown): HarnessSettings {
    return { languageServers: declarations as HarnessSettings["languageServers"] } as HarnessSettings;
  }

  it("answers empty without declarations and never spawns", async () => {
    const service = createLspService({ getSettings: () => ({}) });
    expect(await service.focusDiagnostics(tmpdir(), "a.ts")).toEqual([]);
    await service.disposeAll();
  });

  it("focuses a file through the configured server and rebuilds on declaration changes", async () => {
    const server = fixtureServerFile();
    const root = mkdtempSync(path.join(tmpdir(), "lsp-host-root-"));
    scratch.push(root);
    writeFileSync(path.join(root, "bad.ts"), "line\nline\nconst boom = 1;\n", "utf8");
    let current = settingsOf([
      { id: "fixture", command: process.execPath, args: [server], extensions: [".ts"] },
    ]);
    const logs: string[] = [];
    const service = createLspService({ getSettings: () => current, log: (level, message) => logs.push(`${level}:${message}`) });
    const notes = await service.focusDiagnostics(root, "bad.ts");
    expect(notes).toEqual([{
      path: path.resolve(root, "bad.ts"),
      line: 3,
      column: 2,
      severity: "warning",
      code: "no-boom",
      message: "boom is forbidden",
      source: "fixture",
    }]);
    // 声明变化（签名不同）：重建后同样工作；清空声明：空结果。
    current = settingsOf([
      { id: "fixture2", command: process.execPath, args: [server], extensions: [".ts", ".tsx"] },
    ]);
    const rebuilt = await service.focusDiagnostics(root, "bad.ts");
    expect(rebuilt).toHaveLength(1);
    // 声明重建属预期音（info 启动行 + 旧服务器退出告警），启动失败不可有。
    expect(logs.some((line) => line.includes("failed to start"))).toBe(false);
    current = settingsOf([]);
    expect(await service.focusDiagnostics(root, "bad.ts")).toEqual([]);
    await service.disposeAll();
  });
});
