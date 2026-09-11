import { parseEcosystemHooksDocument } from "@innocenceharness/plugin-hooks";
import { bundleDocuments } from "./bundleDocuments";

export async function readBundleHooks(root: string, manifest?: Record<string, unknown>) {
  const documents = await bundleDocuments(root, "hooks/hooks.json", manifest?.hooks);
  const parsed = documents.map(parseEcosystemHooksDocument);
  return {
    declared: documents.length > 0,
    hooks: parsed.flatMap((entry) => entry.hooks),
    issues: parsed.flatMap((entry) => entry.warnings.map((detail) => ({ component: "hooks", detail }))),
  };
}
