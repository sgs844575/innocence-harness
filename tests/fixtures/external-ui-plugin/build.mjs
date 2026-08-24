import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const [, , userRoot] = process.argv;
if (!userRoot) throw new Error("fixture build requires a user plugin root argument");

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(path.resolve(userRoot), "external-ui-fixture");
const dist = path.join(target, "dist");
await mkdir(dist, { recursive: true });
const source = await readFile(path.join(fixtureDir, "client.ts"), "utf8");
const client = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  fileName: "client.ts",
}).outputText;
await writeFile(path.join(dist, "client.js"), client, "utf8");
const packageJson = JSON.parse(await readFile(path.join(fixtureDir, "package.json"), "utf8"));
await writeFile(path.join(target, "package.json"), `${JSON.stringify({ ...packageJson, main: "./dist/client.js" }, null, 2)}\n`, "utf8");
await writeFile(
  path.join(target, "manifest.json"),
  `${JSON.stringify({ id: "external-ui-fixture", title: "External UI fixture", client: true, toggleable: true }, null, 2)}\n`,
  "utf8",
);
