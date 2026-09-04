import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./app.css", import.meta.url)), "utf8");

describe("code theme CSS slots", () => {
  it("uses the selected theme backgrounds for light, dark, and nested light scopes", () => {
    expect(css).toMatch(/\.msg-body pre\s*\{[^}]*var\(--sdm-bg/s);
    expect(css).toMatch(/\.dark \.msg-body pre\s*\{[^}]*var\(--shiki-dark-bg/s);
    expect(css).toMatch(/\.dark \.light-scope \.msg-body pre\s*\{[^}]*var\(--sdm-bg/s);
    expect(css).toMatch(/\[data-streamdown="code-block-body"\][^{]*\{[^}]*background:\s*transparent/s);
  });
});

describe("diagram block CSS", () => {
  it("uses one tokenized card and removes spacing from the nested render surface", () => {
    expect(css).toMatch(
      /\[data-streamdown="mermaid-block"\]\s*\{[^}]*gap:\s*0[^}]*border-radius:\s*var\(--radius-pop\)[^}]*padding:\s*0/s,
    );
    expect(css).toMatch(
      /\[data-streamdown="mermaid-block"\]\s*>\s*:last-child\s*\{[^}]*border:\s*0[^}]*background:\s*var\(--color-markdown-code\)/s,
    );
    expect(css).toMatch(
      /\[data-streamdown="mermaid"\]\s*\{[^}]*margin:\s*0[^}]*border:\s*0[^}]*padding:\s*0/s,
    );
    expect(css).toMatch(
      /\[data-streamdown="mermaid-block-actions"\]\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s,
    );
  });
});
