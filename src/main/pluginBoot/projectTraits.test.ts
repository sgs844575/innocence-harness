// 项目特征探测纯函数面测试：零 IO——所有事实由入参 ProjectFacts 提供，
// 覆盖 package.json 事实推导、平台特征与缺 package.json 的回落、以及
// topEntries 含 packages 目录判 workspaces 的补充路径。
import { describe, expect, it } from "vitest";
import { detectProjectTraits } from "./projectTraits";

describe("detectProjectTraits", () => {
  it("derives language/test/framework/pkgmanager/monorepo from package.json facts", () => {
    const traits = detectProjectTraits({
      platform: { os: "win32", shell: "powershell" },
      rootPackageJson: {
        devDependencies: { vitest: "^3", typescript: "^5", electron: "^33", react: "^18" },
      },
      lockfiles: ["package-lock.json"],
      topEntries: ["src", "packages", "package.json", "vite.config.ts"],
    });
    expect(traits.language).toBe("typescript");
    expect(traits.test).toBe("vitest");
    expect(traits.framework).toBe("electron");
    expect(traits.pkgmanager).toBe("npm");
    expect(traits.monorepo).toBe("workspaces");
  });

  it("returns platform traits and tolerates missing package.json", () => {
    const traits = detectProjectTraits({
      platform: { os: "linux", shell: "bash" },
      rootPackageJson: undefined,
      lockfiles: [],
      topEntries: ["src"],
    });
    expect(traits.os).toBe("linux");
    expect(traits.shell).toBe("bash");
    expect(traits.language).toBeUndefined();
  });

  it("marks workspaces monorepo from topEntries packages directory alone", () => {
    const traits = detectProjectTraits({
      platform: { os: "darwin", shell: "zsh" },
      rootPackageJson: { devDependencies: { vitest: "^3" } },
      lockfiles: [],
      topEntries: ["src", "packages", "package.json"],
    });
    expect(traits.monorepo).toBe("workspaces");
  });
});
