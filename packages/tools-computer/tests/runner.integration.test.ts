// 真实 runner 集成：powershell.exe 实际进程的输出捕获、非零码、超时与
// 中止杀进程。仅 Windows 宿主执行（其余平台跳过）。
import { describe, expect, it } from "vitest";
import { createPowershellRunner } from "../src/runner";

const windowsOnly = process.platform === "win32" ? describe : describe.skip;

windowsOnly("createPowershellRunner (real powershell process)", () => {
  it("captures stdout and a zero exit code", async () => {
    const result = await createPowershellRunner()({ script: "Write-Output 'runner-ok'" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("runner-ok");
    expect(result.timedOut).toBeFalsy();
  });

  it("propagates non-zero exit codes and stderr", async () => {
    const result = await createPowershellRunner()({
      script: "[Console]::Error.WriteLine('runner-fail'); exit 7",
    });
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("runner-fail");
  });

  it("kills the process on timeout and flags it", async () => {
    const result = await createPowershellRunner()({
      script: "Start-Sleep -Seconds 30",
      timeoutMs: 400,
    });
    expect(result.timedOut).toBe(true);
  });

  it("kills the process when the signal aborts", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await createPowershellRunner()({
      script: "Start-Sleep -Seconds 30",
      signal: controller.signal,
    });
    expect(result.timedOut).toBeFalsy();
    expect(result.exitCode).not.toBe(0);
  });
});
