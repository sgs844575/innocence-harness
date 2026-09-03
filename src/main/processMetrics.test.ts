import { describe, expect, it } from "vitest";
import { toAppProcessMetrics } from "./processMetrics";

describe("toAppProcessMetrics", () => {
  it("映射 pid/type 并把 CPU 与内存折算到一位小数（KB → MB）", () => {
    const rows = toAppProcessMetrics([
      { pid: 1234, type: "Browser", cpu: { percentCPUUsage: 1.234 }, memory: { workingSetSize: 204800 } },
      { pid: 5678, type: "Tab", cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 1024 } },
    ]);
    expect(rows).toEqual([
      { pid: 1234, type: "Browser", cpuPercent: 1.2, memoryMB: 200 },
      { pid: 5678, type: "Tab", cpuPercent: 0, memoryMB: 1 },
    ]);
  });

  it("memory 缺省时按 0 处理", () => {
    const rows = toAppProcessMetrics([{ pid: 1, type: "GPU", cpu: { percentCPUUsage: 2 } }]);
    expect(rows[0]).toEqual({ pid: 1, type: "GPU", cpuPercent: 2, memoryMB: 0 });
  });
});
