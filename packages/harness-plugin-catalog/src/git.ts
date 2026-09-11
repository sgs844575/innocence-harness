import { execFile } from "node:child_process";
import type { RepositorySource } from "./protocol";

export function normalizeSource(input: RepositorySource): RepositorySource {
  if (!input || typeof input.url !== "string") throw new Error("A Git repository URL is required.");
  let url = input.url.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}.git`;
  if (/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(url)) url = `ssh://${url.replace(":", "/")}`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Use an HTTPS or SSH Git URL, or owner/repository."); }
  if (!["https:", "ssh:"].includes(parsed.protocol) || parsed.password || (parsed.protocol === "https:" && parsed.username) || parsed.search || parsed.hash) throw new Error("Use an HTTPS or SSH repository without embedded credentials, query or fragment.");
  const ref = input.ref === undefined ? "" : input.ref;
  if (typeof ref !== "string" || ref.startsWith("-") || /[\s\0]/.test(ref)) throw new Error("Invalid Git revision.");
  const subdir = input.path ?? ".";
  if (typeof subdir !== "string" || subdir.startsWith("/") || /[\\:\0]/.test(subdir) || subdir.split("/").includes("..")) throw new Error("Invalid repository subdirectory.");
  return { url: parsed.toString().replace(/\/$/, ""), ...(ref ? { ref } : {}), path: subdir.replace(/^\.\//, "") || "." };
}
export interface GitPort {
  checkout(source: RepositorySource, destination: string, signal: AbortSignal): Promise<string>;
}
function run(args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-c", "core.longpaths=true", "-c", "core.hooksPath=", "-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never", ...args], {
      windowsHide: true, signal, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message)); else resolve(stdout.trim());
    });
  });
}
export const gitPort: GitPort = {
  async checkout(source, destination, signal) {
    await run(["clone", "--no-checkout", "--depth", "1", "--", source.url, destination], signal);
    if (source.ref) await run(["-C", destination, "fetch", "--depth", "1", "origin", source.ref], signal);
    await run(["-C", destination, "checkout", "--detach", source.ref ? "FETCH_HEAD" : "HEAD", "--"], signal);
    return run(["-C", destination, "rev-parse", "HEAD"], signal);
  },
};
