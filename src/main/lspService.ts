// 语言服务器宿主面（语言服务器波）：settings.languageServers 声明 →
// harness-lsp 会话管理器。每根懒装载；声明变化（签名对比）时旧根整体释
// 放后重建。工作台焦点合流：进程内 TS 诊断之外并上 LSP 诊断（指纹去
// 重、新诊断口径与 S4 注记一致）。本模块 Electron-free，Node 可测。
import {
  createLspManager,
  normalizeServerDescriptor,
  type DiagnosticNote,
  type LspManager,
  type LspServerDescriptor,
} from "@innocenceharness/harness-lsp";
import type { LanguageServerSetting } from "@innocenceharness/harness-electron";

export interface LspServiceDeps {
  /** 当前 settings 快照（组合根注入 getter，设置变更下一次焦点即生效）。 */
  getSettings(): { languageServers?: LanguageServerSetting[] };
  log?(level: "info" | "warn", message: string): void;
}

export interface LspService {
  /** 焦点文件的 LSP 诊断（未配置/无承接服务器 = 空数组）。 */
  focusDiagnostics(workspaceRoot: string, relativePath: string): Promise<DiagnosticNote[]>;
  /** 宿主关机：释放全部服务器子进程。 */
  disposeAll(): Promise<void>;
}

export function createLspService(deps: LspServiceDeps): LspService {
  const manager: LspManager = createLspManager({
    ...(deps.log ? { log: deps.log } : {}),
  });
  const rootSignatures = new Map<string, string>();

  const descriptorsFor = (): LspServerDescriptor[] => {
    const declared = deps.getSettings().languageServers ?? [];
    const descriptors: LspServerDescriptor[] = [];
    for (const entry of declared) {
      const descriptor = normalizeServerDescriptor(entry);
      if (descriptor !== undefined) descriptors.push(descriptor);
    }
    return descriptors;
  };

  return {
    async focusDiagnostics(workspaceRoot, relativePath) {
      const descriptors = descriptorsFor();
      if (descriptors.length === 0) return [];
      const signature = JSON.stringify(descriptors);
      if (rootSignatures.get(workspaceRoot) !== signature) {
        await manager.disposeRoot(workspaceRoot);
        await manager.ensureRoot(workspaceRoot, descriptors);
        rootSignatures.set(workspaceRoot, signature);
      }
      return manager.focusFile(workspaceRoot, relativePath);
    },
    async disposeAll() {
      rootSignatures.clear();
      await manager.disposeAll();
    },
  };
}
