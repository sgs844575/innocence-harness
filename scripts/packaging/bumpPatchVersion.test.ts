import { describe, expect, it } from "vitest";
import { bumpPatchVersion } from "./bumpPatchVersion";

describe("bumpPatchVersion", () => {
  it("递增最后一位且文件其余字节原样保留", () => {
    const raw = `{\n  "name": "innocenceharness",\n  "version": "0.1.0",\n  "scripts": {\n    "package": "electron-forge package"\n  }\n}\n`;
    const { text, from, to } = bumpPatchVersion(raw);
    expect(from).toBe("0.1.0");
    expect(to).toBe("0.1.1");
    expect(text).toBe(raw.replace(`"version": "0.1.0"`, `"version": "0.1.1"`));
  });

  it("承接人工控制的 major.minor：0.2.0 打包一次后指向 0.2.1", () => {
    const { from, to } = bumpPatchVersion(`{\n  "version": "0.2.0"\n}`);
    expect(from).toBe("0.2.0");
    expect(to).toBe("0.2.1");
  });

  it("进位归零：0.1.9 -> 0.1.10", () => {
    const { to } = bumpPatchVersion(`{ "version": "0.1.9" }`);
    expect(to).toBe("0.1.10");
  });

  it("预发布号不自动递增：显式报错交还人工", () => {
    expect(() => bumpPatchVersion(`{ "version": "0.2.0-beta.1" }`)).toThrow(/version/);
  });

  it("缺少版本字段时报错而不是改坏文件", () => {
    expect(() => bumpPatchVersion(`{ "name": "x" }`)).toThrow(/version/);
  });
});
