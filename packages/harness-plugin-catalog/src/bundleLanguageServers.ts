import { bundleDocuments } from "./bundleDocuments";
import { expandBundleValue, type BundleVariables, type BundleIssue } from "./bundleServers";
import { record } from "./files";

export interface BundleLanguageServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  extensions: string[];
  extensionToLanguage: Record<string, string>;
  initializationOptions?: unknown;
  settings?: unknown;
}
export async function readBundleLanguageServers(root: string, manifest?: Record<string, unknown>, variables?: BundleVariables) {
  const servers: Record<string, BundleLanguageServer> = {};
  const issues: BundleIssue[] = [];
  for (const document of await bundleDocuments(root, ".lsp.json", manifest?.lspServers)) {
    const source = record(document);
    for (const [name, raw] of Object.entries(record(source.lspServers ?? source))) {
      delete servers[name];
      try {
        const entry = record(raw);
        if (!/^[A-Za-z0-9_-]+$/.test(name) || typeof entry.command !== "string" || !entry.command.trim()) throw new Error("Invalid language server identifier or command.");
        const unsupported = Object.keys(entry).filter((key) => !["command", "args", "env", "extensionToLanguage", "initializationOptions", "settings", "transport"].includes(key));
        if (unsupported.length || (entry.transport !== undefined && entry.transport !== "stdio")) throw new Error(`Unsupported language server options: ${[...unsupported, ...(entry.transport && entry.transport !== "stdio" ? ["transport"] : [])].join(", ")}`);
        const mapping = record(entry.extensionToLanguage);
        if (!Object.keys(mapping).length || Object.entries(mapping).some(([extension, language]) => !extension.startsWith(".") || typeof language !== "string" || !language)) throw new Error("Invalid extensionToLanguage mapping.");
        if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== "string"))) throw new Error("Invalid language server arguments.");
        if (entry.env !== undefined && (!entry.env || Array.isArray(entry.env) || typeof entry.env !== "object" || Object.values(entry.env).some((value) => typeof value !== "string"))) throw new Error("Invalid language server environment.");
        const expand = (value: string) => expandBundleValue(value, variables);
        const extensionToLanguage = Object.fromEntries(Object.entries(mapping).map(([extension, language]) => [extension.toLowerCase(), language as string]));
        servers[name] = { command: expand(entry.command), args: (entry.args as string[] | undefined)?.map(expand), env: entry.env ? Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, expand(value as string)])) : undefined, extensions: Object.keys(extensionToLanguage), extensionToLanguage, initializationOptions: entry.initializationOptions, settings: entry.settings };
      } catch (error) { issues.push({ component: `lspServers/${name}`, detail: String(error) }); }
    }
  }
  return { servers, issues };
}
