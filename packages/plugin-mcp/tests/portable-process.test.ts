import { expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioJsonRpcClient } from "../src/index";

it.skipIf(process.platform !== "win32")("starts command shims from PATH with spaced paths and literal arguments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "server shim "));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const fixture = fileURLToPath(new URL("./fixtures/echo-server.mjs", import.meta.url));
  await writeFile(path.join(bin, "fixture-runner.cmd"), `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`, "utf8");
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const client = new StdioJsonRpcClient({ command: "fixture-runner", args: ["literal & value"], cwd: root, env: { [pathKey]: `${bin}${path.delimiter}${env[pathKey] ?? ""}` } });
  try {
    await client.start();
    const result = await client.request<{ tools: { name: string }[] }>("tools/list");
    expect(result.tools[0].name).toBe("echo");
  } finally { await client.dispose(); await rm(root, { recursive: true, force: true }); }
});
