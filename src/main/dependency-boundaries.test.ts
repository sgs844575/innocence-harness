import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readManifest(relativePath: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as PackageManifest;
}

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("dependency and host boundary declarations", () => {
  it("declares every renderer drag utility direct import in the root runtime manifest", async () => {
    const manifest = await readManifest("package.json");
    const sources = await Promise.all([
      readSource("src/webview/src/components/Sidebar.tsx"),
      readSource("src/webview/src/components/settings/provider/ProviderRow.tsx"),
    ]);

    expect(sources.every((source) => source.includes('from "@dnd-kit/utilities"'))).toBe(true);
    expect(manifest.dependencies?.["@dnd-kit/utilities"]).toBe("^3.2.2");
  });

  it("declares the host tracing test import and retains the runtime adapter ownership", async () => {
    const [rootManifest, runtimeManifest, hostTelemetryTest, nodeAdapter] = await Promise.all([
      readManifest("package.json"),
      readManifest("packages/harness-ai-runtime/package.json"),
      readSource("src/main/telemetry.test.ts"),
      readSource("packages/harness-ai-runtime/src/node-trace-adapter.ts"),
    ]);

    expect(hostTelemetryTest).toContain('from "@opentelemetry/sdk-trace-node"');
    expect(rootManifest.devDependencies?.["@opentelemetry/sdk-trace-node"]).toBe("^2.6.0");
    expect(nodeAdapter).toContain('from "@opentelemetry/sdk-trace-node"');
    expect(runtimeManifest.dependencies?.["@opentelemetry/sdk-trace-node"]).toBe("2.6.0");
  });

  it("keeps provider SDK and node trace imports out of renderer, shared, and task sources", async () => {
    const paths = [
      "src/webview/src/components/Sidebar.tsx",
      "src/shared/ipc.ts",
      "packages/task-core/src/index.ts",
      "packages/task-workspace/src/index.ts",
    ];
    const sources = await Promise.all(paths.map(readSource));

    expect(sources.join("\n")).not.toMatch(/@ai-sdk\/|from "ai"|sdk-trace-node/);
  });
});
