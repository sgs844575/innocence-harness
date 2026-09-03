import { describe, expect, it } from "vitest";
import { sha256Hex } from "@innocenceharness/harness-tools";

describe("sha256Hex", () => {
  it("produces stable lowercase hex digests", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abd")).not.toBe(sha256Hex("abc"));
  });
});
