import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { windowsEditorInventory } from "./editorDiscoveryWindows";

const execute = promisify(execFile);
export interface EditorInstallation { executable: string; name: string; args?: string[]; iconPath?: string }

export function normalizeEditorInstallations(raw: unknown, platform = process.platform): EditorInstallation[] {
  if (!Array.isArray(raw)) throw new Error("Invalid installed editor inventory.");
  const found = new Map<string, EditorInstallation>();
  for (const item of raw) {
    if (!item || typeof item.name !== "string" || !item.name.trim() || typeof item.executable !== "string") continue;
    const absolute = platform === "win32" ? path.win32.isAbsolute(item.executable) : path.posix.isAbsolute(item.executable);
    if (!absolute) continue;
    const key = platform === "win32" ? item.executable.toLowerCase() : item.executable;
    if (!found.has(key)) found.set(key, { executable: item.executable, name: item.name.trim() });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.executable.localeCompare(b.executable));
}

async function directoryEntries(root: string) {
  return fs.readdir(root, { withFileTypes: true }).catch(() => []);
}

async function discoverApplications(): Promise<EditorInstallation[]> {
  const roots = ["/Applications", path.join(os.homedir(), "Applications")];
  const found: EditorInstallation[] = [];
  for (const root of roots) {
    for (const entry of await directoryEntries(root)) {
      if (!entry.name.endsWith(".app")) continue;
      const bundle = path.join(root, entry.name);
      try {
        const { stdout } = await execute("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(bundle, "Contents", "Info.plist")]);
        const info = JSON.parse(stdout);
        const documents = JSON.stringify(info.CFBundleDocumentTypes ?? []);
        if (!/(source-code|\.tsx?|\.py|\btsx\b|\bjava\b|\brust\b|\bcpp\b)/i.test(documents)) continue;
        found.push({ executable: "/usr/bin/open", args: ["-a", bundle], iconPath: bundle, name: info.CFBundleDisplayName || info.CFBundleName || entry.name.slice(0, -4) });
      } catch { /* Unreadable application bundles are not launch candidates. */ }
    }
  }
  return found;
}

async function discoverDesktopEntries(): Promise<EditorInstallation[]> {
  const roots = [path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "applications"),
    ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").map((root) => path.join(root, "applications"))];
  const found = new Map<string, EditorInstallation>();
  for (const root of roots) {
    for (const entry of await directoryEntries(root)) {
      if (!entry.name.endsWith(".desktop") || found.has(entry.name)) continue;
      const file = path.join(root, entry.name);
      const content = await fs.readFile(file, "utf8").catch(() => "");
      const main = content.split(/^\[Desktop Entry\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
      if (!/^Categories=.*(?:TextEditor|IDE);/m.test(main) || /^(?:Hidden|NoDisplay)=true\s*$/m.test(main)) continue;
      const name = /^Name=(.+)$/m.exec(main)?.[1]?.trim();
      if (name) found.set(entry.name, { executable: "/usr/bin/gio", args: ["launch", file], name });
    }
  }
  return [...found.values()];
}

export async function discoverInstalledEditors(): Promise<EditorInstallation[]> {
  if (process.platform === "darwin") return discoverApplications();
  if (process.platform !== "win32") return discoverDesktopEntries();
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const { stdout } = await execute(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(windowsEditorInventory, "utf16le").toString("base64")], {
    windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: "utf8",
  });
  return normalizeEditorInstallations(JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "[]"));
}
