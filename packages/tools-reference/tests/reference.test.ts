import { describe, expect, it } from "vitest";
import { referenceCatalog, readReferenceTool, ReferencePlugin } from "../src";

const ctx = { signal: new AbortController().signal } as never;

describe("read_reference tool", () => {
  it("exposes four catalog entries enumerated in the tool description", () => {
    expect(referenceCatalog.map((e) => e.id)).toEqual([
      "data-visualization", "http-error-codes", "tool-use-concepts", "prompt-caching",
    ]);
    for (const entry of referenceCatalog) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.length).toBeGreaterThan(400);
      expect(readReferenceTool.description).toContain(entry.id);
    }
  });
  it("returns body content for a known id", async () => {
    const res = await readReferenceTool.execute({ id: "http-error-codes" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain("429");
    expect(res.content).toContain("503");
  });
  it("errors on unknown id listing valid ids", async () => {
    const res = await readReferenceTool.execute({ id: "nope" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toContain("data-visualization");
  });
  it("is read-only with a reference-scoped permission resource", () => {
    expect(readReferenceTool.readOnly).toBe(true);
    expect(readReferenceTool.permissionResource({ id: "prompt-caching" }, ctx)).toEqual({
      action: "read",
      kind: "reference",
      scope: "prompt-caching",
    });
  });
  it("persists only the requested id", () => {
    expect(readReferenceTool.persistArgs({ id: "verify" })).toEqual({ id: "verify" });
  });
  it("registers via the plugin", () => {
    const registered: string[] = [];
    ReferencePlugin.apply({ tools: { register: (t: { name: string }) => registered.push(t.name) } } as never);
    expect(registered).toEqual(["read_reference"]);
  });
  it("entries are English and banned-token free", () => {
    for (const e of referenceCatalog) {
      expect(e.body).not.toMatch(/[\u4e00-\u9fff]/);
      for (const re of [/Claude/i, /Anthropic/i, /OpenAI/i, /ChatGPT/i, /Codex/i, /Gemini/i]) {
        expect(`${e.id}:${e.title}:${e.body}`).not.toMatch(re);
      }
    }
  });
});
