// Kernel 身份与版本门：kernelPath 是可被环境/测试覆盖的磁盘路径，boot 前
// 用包身份解析确认它确实是预期的内核包，并对其声明的版本做兼容检查——
// staging 树损坏或指向不兼容内核时给出明确错误，而不是加载后行为未知。
import { readFileSync } from "node:fs";
import path from "node:path";
import moduleDetailsFromPath from "module-details-from-path";
import { satisfies as semverSatisfies } from "semver";

export const KERNEL_MODULE_NAME = "@innocenceharness/kernel";

/** 宿主支持的内核版本范围（与根 package.json 版本节奏同步维护）。 */
export const HOST_SUPPORTED_KERNEL_RANGE = "^0.1.0";

export interface KernelIdentityCheckOptions {
  /** 期望包名；缺省 {@link KERNEL_MODULE_NAME}。仅测试注入。 */
  expectedName?: string;
  /** 兼容版本范围；缺省 {@link HOST_SUPPORTED_KERNEL_RANGE}。仅测试注入。 */
  supportedRange?: string;
  /** package.json 读取面；缺省真实 fs，仅测试注入。 */
  readPackageJson?: (file: string) => unknown;
}

/**
 * 校验 kernelPath 的模块身份与版本兼容性：路径必须解析为预期的内核包
 * （node_modules 形态），且其 package.json 版本落在宿主支持范围内。
 * 不满足即抛错——boot 侧按加载失败处理（不缓存、可重试）。
 */
export function assertKernelModuleIdentity(kernelPath: string, options: KernelIdentityCheckOptions = {}): void {
  const expectedName = options.expectedName ?? KERNEL_MODULE_NAME;
  const supportedRange = options.supportedRange ?? HOST_SUPPORTED_KERNEL_RANGE;
  const readPackageJson = options.readPackageJson ?? ((file: string) => JSON.parse(readFileSync(file, "utf8")));

  const details = moduleDetailsFromPath(kernelPath);
  if (!details || details.name !== expectedName) {
    throw new Error(
      `kernel path does not resolve to ${expectedName}: ${kernelPath}`,
    );
  }

  const manifestFile = path.join(details.basedir, "package.json");
  let manifest: unknown;
  try {
    manifest = readPackageJson(manifestFile);
  } catch (error) {
    throw new Error(`kernel manifest unreadable (${manifestFile}): ${String(error)}`);
  }
  const version = (manifest as { version?: unknown } | null)?.version;
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error(`kernel manifest has no version (${manifestFile})`);
  }
  if (!semverSatisfies(version, supportedRange)) {
    throw new Error(
      `kernel version ${version} does not satisfy host-supported range ${supportedRange}`,
    );
  }
}
