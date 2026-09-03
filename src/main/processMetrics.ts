// 进程监视器的数据映射：app.getAppMetrics() 原始结构 → 渲染层投影。
// 纯函数无 electron 依赖（结构镜像 Electron ProcessMetric），IPC 薄壳在 ipc.ts。
import type { AppProcessMetric } from "../shared/ipc";

/** Electron ProcessMetric 的结构镜像（只取用到的字段；兼容缺失的 memory）。 */
export interface RawProcessMetric {
  pid: number;
  type: string;
  cpu: { percentCPUUsage: number };
  /** workingSetSize 单位 KB；部分进程类别可能缺省。 */
  memory?: { workingSetSize?: number };
}

export function toAppProcessMetrics(list: RawProcessMetric[]): AppProcessMetric[] {
  return list.map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    cpuPercent: Math.round(metric.cpu.percentCPUUsage * 10) / 10,
    memoryMB: Math.round(((metric.memory?.workingSetSize ?? 0) / 1024) * 10) / 10,
  }));
}
