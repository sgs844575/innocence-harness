import { describe, expect, it } from "vitest";
import { createZipArchive } from "../src/archive";

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
