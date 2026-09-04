// 早期启动设置（app ready 之前生效的部分）：Chromium 硬件加速开关、代理开
// 关与子进程环境变量。同步读取持久化设置文件并容忍缺失/损坏（一律 no-op）
// ——启动路径不容因设置损坏而拒绝启动。决策面是纯函数（planEarlyBoot），
// Electron 接触点集中在 applyEarlyBootSettings，便于 vitest 直接覆盖。
import { app } from "electron";
import fs from "node:fs";

/** 早期启动消费的最小设置面（直接读持久化 JSON，未经 mergeSettings 归一）。 */
export interface EarlyBootSettings {
  hardwareAcceleration?: unknown;
  httpProxy?: unknown;
  proxyBypass?: unknown;
  customCaCert?: unknown;
}

export interface EarlyBootPlan {
  disableHardwareAcceleration: boolean;
  switches: { name: string; value: string }[];
  env: { name: string; value: string }[];
}

/** 同步读取设置文件；缺失/损坏/非对象 → 空设置（全部 no-op）。 */
export function readEarlyBootSettings(settingsJsonPath: string): EarlyBootSettings {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(settingsJsonPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as EarlyBootSettings;
  } catch {
    return {};
  }
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * 早期启动决策（纯函数）：只在设置显式配置时施加对应效果；未配置的项绝不
 * 触碰既有状态（不清空调用方已有的环境变量、不改默认开关）。
 */
export function planEarlyBoot(settings: EarlyBootSettings): EarlyBootPlan {
  const plan: EarlyBootPlan = { disableHardwareAcceleration: false, switches: [], env: [] };
  if (settings.hardwareAcceleration === false) plan.disableHardwareAcceleration = true;
  if (nonEmpty(settings.httpProxy)) {
    const proxy = settings.httpProxy.trim();
    plan.switches.push({ name: "proxy-server", value: proxy });
    // 之后孵化的子进程（模型 SDK / MCP / 命令工具）经 process.env 继承。
    plan.env.push({ name: "HTTP_PROXY", value: proxy }, { name: "HTTPS_PROXY", value: proxy });
  }
  if (nonEmpty(settings.proxyBypass)) {
    const bypass = settings.proxyBypass.trim();
    // Chromium 绕过列表用分号分隔（设置面为逗号分隔）。
    const chromiumList = bypass
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .join(";");
    if (chromiumList !== "") plan.switches.push({ name: "proxy-bypass-list", value: chromiumList });
    plan.env.push({ name: "NO_PROXY", value: bypass });
  }
  if (nonEmpty(settings.customCaCert)) {
    // 主进程自身的 TLS 栈仅在进程引导期读取 NODE_EXTRA_CA_CERTS——此处设置
    // 的目标同样是之后孵化的子进程（经 process.env 继承）；渲染层证书的
    // 自定义校验见 customCaVerify.ts。
    plan.env.push({ name: "NODE_EXTRA_CA_CERTS", value: settings.customCaCert.trim() });
  }
  return plan;
}

/**
 * 读取设置文件并施加早期启动效果。必须在 app.whenReady() 之前调用（硬件
 * 加速与 commandLine 开关过了 ready 就不再生效）。
 */
export function applyEarlyBootSettings(settingsJsonPath: string): void {
  const plan = planEarlyBoot(readEarlyBootSettings(settingsJsonPath));
  if (plan.disableHardwareAcceleration) app.disableHardwareAcceleration();
  for (const { name, value } of plan.switches) app.commandLine.appendSwitch(name, value);
  for (const { name, value } of plan.env) process.env[name] = value;
}
