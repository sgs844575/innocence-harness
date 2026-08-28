import { describe, expect, it } from "vitest";
import { createZipArchive, decryptArchive, encryptArchive, isEncryptedArchive } from "../src/archive";

describe("createZipArchive", () => {
  it("produces a zip container with local file headers and an end-of-central-directory", async () => {
    const blob = await createZipArchive([
      { name: "a.txt", data: Buffer.from("你好，工作区", "utf8") },
      { name: "nested/b.bin", data: Buffer.from([1, 2, 3, 4]) },
    ]);
    expect(blob.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(blob.includes(Buffer.from("PK\u0005\u0006", "latin1"))).toBe(true);
  });

  it("rejects empty entry lists", async () => {
    await expect(createZipArchive([])).rejects.toThrow("条目为空");
  });
});

describe("encryptArchive / decryptArchive", () => {
  it("round-trips a payload through the passphrase", () => {
    const payload = Buffer.from("归档内容 secret-9f3a", "utf8");
    const encrypted = encryptArchive(payload, "正确口令");
    expect(isEncryptedArchive(encrypted)).toBe(true);
    expect(encrypted.equals(payload)).toBe(false);
    expect(decryptArchive(encrypted, "正确口令").equals(payload)).toBe(true);
  });

  it("produces different ciphertext for the same payload across calls", () => {
    const payload = Buffer.from("same", "utf8");
    const a = encryptArchive(payload, "pw");
    const b = encryptArchive(payload, "pw");
    expect(a.equals(b)).toBe(false);
  });

  it("fails loudly on a wrong passphrase", () => {
    const payload = Buffer.from("top secret", "utf8");
    const encrypted = encryptArchive(payload, "right");
    expect(() => decryptArchive(encrypted, "wrong")).toThrow("口令错误");
  });

  it("rejects foreign blobs and empty passphrases", () => {
    expect(() => decryptArchive(Buffer.from("plain zip bytes"), "pw")).toThrow("不是加密归档");
    expect(() => encryptArchive(Buffer.from("x"), " ")).toThrow("口令不能为空");
    expect(isEncryptedArchive(Buffer.from("IHARCHNOT", "utf8"))).toBe(false);
  });
});
