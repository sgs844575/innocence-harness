// 分帧与诊断投影的纯单元测试。
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodeLspMessage, LspFrameDecoder } from "../src/protocol";
import { diagnosticFingerprint, mapSeverity, pathToUri, projectDiagnostics, uriToPath } from "../src/diagnostics";
import { mergeDiagnostics } from "../src/manager";

describe("LspFrameDecoder", () => {
  it("round-trips one message and splits it across arbitrary chunk boundaries", () => {
    const decoder = new LspFrameDecoder();
    const frame = encodeLspMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { a: "文" } });
    const first = decoder.feed(frame.subarray(0, 7));
    const second = decoder.feed(frame.subarray(7));
    expect(first).toEqual([]);
    expect(second).toEqual([{ jsonrpc: "2.0", id: 1, method: "initialize", params: { a: "文" } }]);
  });

  it("emits multiple messages from one chunk in order", () => {
    const decoder = new LspFrameDecoder();
    const chunk = Buffer.concat([
      encodeLspMessage({ jsonrpc: "2.0", method: "initialized" }),
      encodeLspMessage({ jsonrpc: "2.0", id: 2, result: { capabilities: {} } }),
    ]);
    const messages = decoder.feed(chunk);
    expect(messages).toHaveLength(2);
    expect(messages[0].method).toBe("initialized");
    expect(messages[1].id).toBe(2);
  });

  it("rejects a malformed header or body outright", () => {
    expect(() => new LspFrameDecoder().feed(Buffer.from("Not-Json-Rpc: 1\r\n\r\n{}"))).toThrow(/Content-Length/);
    expect(() => new LspFrameDecoder().feed(Buffer.from("Content-Length: 2\r\n\r\nno"))).toThrow();
  });
});

describe("severity + diagnostics projection", () => {
  it("maps LSP severities with unknown values failing explicit", () => {
    expect(mapSeverity(1)).toBe("error");
    expect(mapSeverity(2)).toBe("warning");
    expect(mapSeverity(3)).toBe("info");
    expect(mapSeverity(4)).toBe("hint");
    expect(mapSeverity(undefined)).toBe("error");
  });

  it("projects a publishDiagnostics payload onto 1-based neutral notes", () => {
    const uri = pathToUri(process.platform === "win32" ? "D:\\ws\\a.ts" : "/ws/a.ts");
    const notes = projectDiagnostics(uri, [
      { range: { start: { line: 0, character: 3 } }, severity: 1, code: 2322, message: "type mismatch", source: "tsserver" },
      { range: { start: { line: 9 } }, message: "no severity" },
      { message: "" },
      "junk",
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ severity: "error", code: 2322, line: 1, column: 4, message: "type mismatch", source: "tsserver" });
    expect(notes[1]).toMatchObject({ severity: "error", line: 10, column: 1 });
    expect(notes[0].path.endsWith(path.join("ws", "a.ts"))).toBe(true);
  });

  it("round-trips path <-> file uri", () => {
    const original = process.platform === "win32" ? "D:\\ws\\子 dir\\a b.ts" : "/ws/子 dir/a b.ts";
    expect(uriToPath(pathToUri(original))).toBe(original);
  });

  it("dedupes merged diagnostics by fingerprint and keeps order", () => {
    const note = { path: "a.ts", line: 1, column: 1, severity: "error" as const, message: "x" };
    const other = { ...note, message: "y" };
    expect(mergeDiagnostics([[note], [note, other]])).toEqual([note, other]);
    expect(diagnosticFingerprint(note)).not.toBe(diagnosticFingerprint(other));
  });
});
