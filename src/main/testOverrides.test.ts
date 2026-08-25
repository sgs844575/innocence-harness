import { describe, expect, it } from "vitest";
import { resolveTestOverrides } from "./testOverrides";

describe("test-only environment overrides", () => {
  it("ignores override paths in packaged production without the controlled launch marker", () => {
    expect(resolveTestOverrides({
      isPackaged: true,
      env: {
        INNOCENCEHARNESS_TEST_USER_DATA: "C:/untrusted/user-data",
        INNOCENCEHARNESS_TEST_USER_PLUGIN_ROOT: "C:/untrusted/user-plugins",
        INNOCENCEHARNESS_TEST_BUILTIN_PLUGIN_ROOT: "C:/untrusted/builtin-plugins",
        INNOCENCEHARNESS_TEST_MODE: "1",
      },
      argv: [],
    })).toEqual({ enabled: false });
  });

  it("allows packaged acceptance overrides only with the environment and argument markers", () => {
    expect(resolveTestOverrides({
      isPackaged: true,
      env: {
        INNOCENCEHARNESS_TEST_USER_DATA: "C:/test/user-data",
        INNOCENCEHARNESS_TEST_USER_PLUGIN_ROOT: "C:/test/user-plugins",
        INNOCENCEHARNESS_TEST_BUILTIN_PLUGIN_ROOT: "C:/test/builtin-plugins",
        INNOCENCEHARNESS_TEST_MODE: "1",
      },
      argv: ["app.exe", "--innocence-controlled-test"],
    })).toEqual({
      enabled: true,
      userData: "C:/test/user-data",
      userPluginRoot: "C:/test/user-plugins",
      builtinPluginRoot: "C:/test/builtin-plugins",
    });
  });

  it("ignores development overrides without the controlled environment marker", () => {
    expect(resolveTestOverrides({
      isPackaged: false,
      env: {
        INNOCENCEHARNESS_TEST_USER_DATA: "C:/untrusted/user-data",
        INNOCENCEHARNESS_TEST_USER_PLUGIN_ROOT: "C:/untrusted/user-plugins",
        INNOCENCEHARNESS_TEST_BUILTIN_PLUGIN_ROOT: "C:/untrusted/builtin-plugins",
      },
      argv: [],
    })).toEqual({ enabled: false });
  });

  it("ignores legacy environment variables even when the legacy marker is present", () => {
    expect(resolveTestOverrides({
      isPackaged: false,
      env: {
        INNOCENCE_TEST_USER_DATA: "C:/old/user-data",
        INNOCENCE_TEST_USER_PLUGIN_ROOT: "C:/old/user-plugins",
        INNOCENCE_TEST_BUILTIN_PLUGIN_ROOT: "C:/old/builtin-plugins",
        INNOCENCE_TEST_MODE: "1",
      },
      argv: [],
    })).toEqual({ enabled: false });
  });

  it("allows ordinary development acceptance with the controlled environment marker", () => {
    expect(resolveTestOverrides({
      isPackaged: false,
      env: {
        INNOCENCEHARNESS_TEST_USER_DATA: "C:/test/user-data",
        INNOCENCEHARNESS_TEST_MODE: "1",
      },
      argv: [],
    })).toEqual({ enabled: true, userData: "C:/test/user-data" });
  });
});
