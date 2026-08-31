import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseFocusedFile, diagnosticFingerprint } from "../src";

describe("focused TypeScript diagnostics", () => {
  it("reports a focused file's compiler diagnostic with line and code", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ic-diag-"));
    fs.writeFileSync(path.join(root, "bad.ts"), "const x: string = 1;\n", "utf8");
    const notes = diagnoseFocusedFile(root, "bad.ts");
    expect(notes.some((n) => n.code === 2322 && n.line === 1)).toBe(true);
    expect(diagnosticFingerprint(notes[0]!).split(":").length).toBeGreaterThan(3);
  });

  it("ignores non-code files and missing paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ic-diag-"));
    fs.writeFileSync(path.join(root, "note.md"), "x", "utf8");
    expect(diagnoseFocusedFile(root, "note.md")).toEqual([]);
    expect(diagnoseFocusedFile(root, "missing.ts")).toEqual([]);
  });
});
