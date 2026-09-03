// keys.ts 全分支：命名键、功能键、普通字符、SendKeys 保留字符转义、
// 修饰符组合（任意顺序归一化）、非法输入抛错。
import { describe, expect, it } from "vitest";
import { toSendKeysSequence } from "../src/internal/keys";

describe("toSendKeysSequence", () => {
  it("maps named keys to SendKeys tokens", () => {
    expect(toSendKeysSequence("enter")).toBe("{ENTER}");
    expect(toSendKeysSequence("esc")).toBe("{ESC}");
    expect(toSendKeysSequence("tab")).toBe("{TAB}");
    expect(toSendKeysSequence("up")).toBe("{UP}");
    expect(toSendKeysSequence("down")).toBe("{DOWN}");
    expect(toSendKeysSequence("left")).toBe("{LEFT}");
    expect(toSendKeysSequence("right")).toBe("{RIGHT}");
    expect(toSendKeysSequence("home")).toBe("{HOME}");
    expect(toSendKeysSequence("end")).toBe("{END}");
    expect(toSendKeysSequence("pgup")).toBe("{PGUP}");
    expect(toSendKeysSequence("pgdn")).toBe("{PGDN}");
    expect(toSendKeysSequence("delete")).toBe("{DELETE}");
    expect(toSendKeysSequence("backspace")).toBe("{BACKSPACE}");
    expect(toSendKeysSequence("space")).toBe(" ");
  });

  it("maps function keys and matches names case-insensitively", () => {
    expect(toSendKeysSequence("f1")).toBe("{F1}");
    expect(toSendKeysSequence("f12")).toBe("{F12}");
    expect(toSendKeysSequence("F5")).toBe("{F5}");
    expect(toSendKeysSequence("ENTER")).toBe("{ENTER}");
    expect(toSendKeysSequence("Esc")).toBe("{ESC}");
  });

  it("passes plain characters through, keeping uppercase for shift semantics", () => {
    expect(toSendKeysSequence("a")).toBe("a");
    expect(toSendKeysSequence("5")).toBe("5");
    expect(toSendKeysSequence("A")).toBe("A");
  });

  it("escapes SendKeys special characters with braces", () => {
    expect(toSendKeysSequence("{")).toBe("{{}");
    expect(toSendKeysSequence("}")).toBe("{}}");
    expect(toSendKeysSequence("^")).toBe("{^}");
    expect(toSendKeysSequence("%")).toBe("{%}");
    expect(toSendKeysSequence("~")).toBe("{~}");
    expect(toSendKeysSequence("(")).toBe("{(}");
    expect(toSendKeysSequence(")")).toBe("{)}");
    expect(toSendKeysSequence("[")).toBe("{[}");
    expect(toSendKeysSequence("]")).toBe("{]}");
    expect(toSendKeysSequence("+")).toBe("{+}");
  });

  it("builds modifier combinations in canonical order regardless of input order", () => {
    expect(toSendKeysSequence("ctrl+c")).toBe("^c");
    expect(toSendKeysSequence("alt+f4")).toBe("%{F4}");
    expect(toSendKeysSequence("ctrl+shift+tab")).toBe("^+{TAB}");
    expect(toSendKeysSequence("shift+ctrl+tab")).toBe("^+{TAB}");
    expect(toSendKeysSequence("alt+ctrl+delete")).toBe("^%{DELETE}");
    expect(toSendKeysSequence("ctrl+{")).toBe("^{{}");
    expect(toSendKeysSequence("ctrl+ctrl+c")).toBe("^c");
  });

  it("rejects empty, oversized and malformed input", () => {
    expect(() => toSendKeysSequence("")).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("a".repeat(33))).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("ctrl")).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("ctrl+shift")).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("ctrl+")).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("+c")).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("a+b")).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("f13")).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("pageup")).toThrow(/Unsupported key/);
    expect(() => toSendKeysSequence("ctrl+alt+win")).toThrow(/Unsupported key/);
  });
});
