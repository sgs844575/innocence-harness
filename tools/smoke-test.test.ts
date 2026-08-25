import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const smokeScript = path.resolve(__dirname, "smoke-test.cjs");

describe("packaged smoke launcher naming", () => {
  it("uses the renamed smoke handshake and marker prefix", () => {
    const source = readFileSync(smokeScript, "utf8");
    expect(source).toContain("InnocenceHarness_SMOKE_OUT: marker");
    expect(source).toContain("innocenceharness-smoke-");
    expect(source).not.toContain("InnocenceCode_SMOKE_OUT");
    expect(source).not.toContain("innocencecode-smoke-");
  });
});
