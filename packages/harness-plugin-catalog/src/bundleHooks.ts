import { parseEcosystemHooksDocument } from "@innocenceharness/plugin-hooks";
import { bundleDocuments } from "./bundleDocuments";

export async function readBundleHooks(root: string, manifest?: Record<string, unknown>) {
  const documents = await bundleDocuments(root, "hooks/hooks.json", manifest?.hooks);
  // 安装根随解析下发：命令里的插件根变量（外部协议拼写）就地展开。
  const parsed = documents.map((document) => parseEcosystemHooksDocument(document, { pluginRoot: root }));
  return {
    declared: documents.length > 0,
    hooks: parsed.flatMap((entry) => entry.hooks),
    issues: parsed.flatMap((entry) => entry.warnings.map((detail) => ({ component: "hooks", detail }))),
  };
}
