import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ImportViolation {
  packageName: string;
  sourcePath: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scannedSourceRoots = [
  "src/webview/src",
  "src/shared",
  "packages/task-core/src",
  "packages/task-workspace/src",
];
const excludedSourceDirectories = new Set(["build", "generated", "node_modules"]);
const sourceFileExtensions = new Set([".js", ".ts", ".tsx"]);

async function readManifest(relativePath: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as PackageManifest;
}

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

function isForbiddenPackage(packageName: string): boolean {
  return packageName === "ai"
    || packageName.startsWith("ai/")
    || packageName.startsWith("@ai-sdk/")
    || packageName.startsWith("@opentelemetry/sdk-trace-");
}

function getModuleSpecifier(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : undefined;
  }

  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
  }

  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
    return undefined;
  }

  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return node.arguments[0].text;
  }

  return ts.isIdentifier(node.expression) && node.expression.text === "require"
    ? node.arguments[0].text
    : undefined;
}

function findForbiddenPackageSpecifiers(source: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false);
  const packageNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    const packageName = getModuleSpecifier(node);
    if (packageName && isForbiddenPackage(packageName)) {
      packageNames.add(packageName);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...packageNames].sort();
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return excludedSourceDirectories.has(entry.name) ? [] : collectSourceFiles(entryPath);
    }
    return entry.isFile() && sourceFileExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  }));

  return files.flat();
}

async function findForbiddenImports(sourceRoots: string[]): Promise<ImportViolation[]> {
  const sourceFiles = (await Promise.all(sourceRoots.map(collectSourceFiles))).flat().sort();
  const violations = await Promise.all(sourceFiles.map(async (sourcePath) => {
    const source = await readFile(sourcePath, "utf8");
    return findForbiddenPackageSpecifiers(source, sourcePath).map((packageName) => ({
      packageName,
      sourcePath: path.relative(root, sourcePath),
    }));
  }));

  return violations.flat().sort((left, right) => {
    if (left.sourcePath !== right.sourcePath) {
      return left.sourcePath < right.sourcePath ? -1 : 1;
    }
    if (left.packageName === right.packageName) {
      return 0;
    }
    return left.packageName < right.packageName ? -1 : 1;
  });
}

async function assertNoForbiddenImports(sourceRoots: string[]): Promise<void> {
  const violations = await findForbiddenImports(sourceRoots);
  if (violations.length > 0) {
    throw new Error(`Forbidden provider or tracing imports:\n${violations.map(
      ({ packageName, sourcePath }) => `- ${sourcePath}: ${packageName}`,
    ).join("\n")}`);
  }
}

async function writeFixtureSource(fixtureDirectory: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(fixtureDirectory, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source, "utf8");
}

describe("dependency and host boundary declarations", () => {
  it("keeps the Node trace adapter in the host and outside staged runtime dependencies", async () => {
    const [rootManifest, runtimeManifest, hostTelemetryTest, nodeAdapter] = await Promise.all([
      readManifest("package.json"),
      readManifest("packages/harness-ai-runtime/package.json"),
      readSource("src/main/telemetry.test.ts"),
      readSource("src/main/nodeTraceAdapter.ts"),
    ]);

    expect(hostTelemetryTest).toContain('from "@opentelemetry/sdk-trace-node"');
    expect(rootManifest.devDependencies?.["@opentelemetry/sdk-trace-node"]).toBe("^2.6.0");
    expect(nodeAdapter).toContain('from "@opentelemetry/sdk-trace-node"');
    expect(runtimeManifest.dependencies?.["@opentelemetry/sdk-trace-node"]).toBeUndefined();
  });

  it("keeps provider SDK and node trace imports out of renderer, shared, and task sources", async () => {
    await expect(assertNoForbiddenImports(scannedSourceRoots)).resolves.toBeUndefined();
  });

  it("detects forbidden static, dynamic, and CommonJS imports while skipping output directories", async () => {
    const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), "dependency-boundaries-test-"));
    try {
      await Promise.all([
        writeFixtureSource(fixtureDirectory, "nested/static.ts", 'import "ai";\n'),
        writeFixtureSource(fixtureDirectory, "nested/dynamic.ts", 'await import("@ai-sdk/openai");\n'),
        writeFixtureSource(fixtureDirectory, "nested/commonjs.js", 'require("@opentelemetry/sdk-trace-node");\n'),
        writeFixtureSource(fixtureDirectory, "generated/ignored.ts", 'import "ai";\n'),
        writeFixtureSource(fixtureDirectory, "build/ignored.ts", 'import "@ai-sdk/openai";\n'),
        writeFixtureSource(fixtureDirectory, "node_modules/ignored.js", 'require("@opentelemetry/sdk-trace-node");\n'),
      ]);

      const violations = await findForbiddenImports([fixtureDirectory]);
      expect(violations).toHaveLength(3);
      expect(violations.map(({ packageName }) => packageName).sort()).toEqual([
        "@ai-sdk/openai",
        "@opentelemetry/sdk-trace-node",
        "ai",
      ]);
      await expect(assertNoForbiddenImports([fixtureDirectory])).rejects.toThrow(
        "Forbidden provider or tracing imports",
      );
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
