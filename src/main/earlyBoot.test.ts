// 早期启动设置：文件读取容错 + 决策纯函数 + Electron 施加面。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
  },
}));

import { app } from "electron";
import { applyEarlyBootSettings, planEarlyBoot, readEarlyBootSettings } from "./earlyBoot";

const tempDirs: string[] = [];
const touchedEnv: string[] = [];

function settingsFile(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "earlyboot-"));
  tempDirs.push(dir);
  const file = path.join(dir, "harness-settings.json");
  writeFileSync(file, content, "utf8");
  return file;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  while (touchedEnv.length > 0) delete process.env[touchedEnv.pop()!];
  vi.clearAllMocks();
});

describe("readEarlyBootSettings", () => {
  it("文件缺失/损坏/非对象 → 空设置", () => {
    expect(readEarlyBootSettings(path.join(os.tmpdir(), "earlyboot-no-such-file.json"))).toEqual({});
    expect(readEarlyBootSettings(settingsFile("not json {"))).toEqual({});
    expect(readEarlyBootSettings(settingsFile("[1,2]"))).toEqual({});
    expect(readEarlyBootSettings(settingsFile('"text"'))).toEqual({});
  });

  it("读取有效设置文件的早期启动字段", () => {
    const file = settingsFile(JSON.stringify({ hardwareAcceleration: false, httpProxy: "http://127.0.0.1:7890" }));
    expect(readEarlyBootSettings(file)).toMatchObject({
      hardwareAcceleration: false,
      httpProxy: "http://127.0.0.1:7890",
    });
  });
});

describe("planEarlyBoot", () => {
  it("空设置 → 全部 no-op", () => {
    expect(planEarlyBoot({})).toEqual({ disableHardwareAcceleration: false, switches: [], env: [] });
  });

  it("hardwareAcceleration === false 才禁用；true/缺省不动", () => {
    expect(planEarlyBoot({ hardwareAcceleration: false }).disableHardwareAcceleration).toBe(true);
    expect(planEarlyBoot({ hardwareAcceleration: true }).disableHardwareAcceleration).toBe(false);
    expect(planEarlyBoot({}).disableHardwareAcceleration).toBe(false);
  });

  it("httpProxy → proxy-server 开关 + HTTP(S)_PROXY 环境", () => {
    const plan = planEarlyBoot({ httpProxy: " http://proxy:8080 " });
    expect(plan.switches).toEqual([{ name: "proxy-server", value: "http://proxy:8080" }]);
    expect(plan.env).toEqual([
      { name: "HTTP_PROXY", value: "http://proxy:8080" },
      { name: "HTTPS_PROXY", value: "http://proxy:8080" },
    ]);
  });

  it("proxyBypass → 分号分隔的 Chromium 列表 + 原样 NO_PROXY", () => {
    const plan = planEarlyBoot({ proxyBypass: "localhost, 127.0.0.1 ,*.corp.internal" });
    expect(plan.switches).toEqual([
      { name: "proxy-bypass-list", value: "localhost;127.0.0.1;*.corp.internal" },
    ]);
    expect(plan.env).toEqual([{ name: "NO_PROXY", value: "localhost, 127.0.0.1 ,*.corp.internal" }]);
  });

  it("customCaCert → NODE_EXTRA_CA_CERTS；空串不设置", () => {
    expect(planEarlyBoot({ customCaCert: "C:\\certs\\corp.pem" }).env).toEqual([
      { name: "NODE_EXTRA_CA_CERTS", value: "C:\\certs\\corp.pem" },
    ]);
    expect(planEarlyBoot({ customCaCert: "  " }).env).toEqual([]);
    expect(planEarlyBoot({ httpProxy: "", proxyBypass: "" }).switches).toEqual([]);
  });
});

describe("applyEarlyBootSettings", () => {
  it("按设置文件施加 Electron 开关与环境变量", () => {
    const file = settingsFile(JSON.stringify({
      hardwareAcceleration: false,
      httpProxy: "http://proxy:8080",
      proxyBypass: "localhost,example.com",
      customCaCert: "C:\\certs\\corp.pem",
    }));
    touchedEnv.push("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS");

    applyEarlyBootSettings(file);

    expect(app.disableHardwareAcceleration).toHaveBeenCalledTimes(1);
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("proxy-server", "http://proxy:8080");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("proxy-bypass-list", "localhost;example.com");
    expect(process.env.HTTP_PROXY).toBe("http://proxy:8080");
    expect(process.env.HTTPS_PROXY).toBe("http://proxy:8080");
    expect(process.env.NO_PROXY).toBe("localhost,example.com");
    expect(process.env.NODE_EXTRA_CA_CERTS).toBe("C:\\certs\\corp.pem");
  });

  it("未配置时不触碰任何开关与既有环境变量", () => {
    process.env.HTTP_PROXY = "pre-existing";
    touchedEnv.push("HTTP_PROXY");

    applyEarlyBootSettings(settingsFile("{}"));

    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
    expect(process.env.HTTP_PROXY).toBe("pre-existing");
    expect(process.env.NODE_EXTRA_CA_CERTS).toBeUndefined();
  });
});
