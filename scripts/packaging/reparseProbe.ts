import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ReparseProbeResult {
  kind: "ordinary" | "reparse" | "unknown";
  tag?: string;
  diagnostic?: string;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Windows does not expose the reparse tag through Stats. PowerShell provides a
 * locale-independent ReparsePoint attribute check; fsutil then supplies the
 * tag for diagnostics. Any probe failure is unknown and must be rejected by
 * the caller rather than treated as an ordinary directory.
 */
export async function probeWindowsReparsePoint(target: string): Promise<ReparseProbeResult> {
  if (process.platform !== "win32") return { kind: "ordinary" };

  const escapedTarget = target.replaceAll("'", "''");
  try {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$item = Get-Item -LiteralPath '${escapedTarget}' -Force -ErrorAction Stop; [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)`,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    if (stdout.trim().toLowerCase() === "false") return { kind: "ordinary" };
    if (stdout.trim().toLowerCase() !== "true") {
      return { kind: "unknown", diagnostic: `unexpected reparse probe output: ${stdout.trim()}` };
    }
  } catch (error) {
    return { kind: "unknown", diagnostic: `reparse attribute probe failed: ${formatError(error)}` };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "fsutil",
      ["reparsepoint", "query", target],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const output = `${stdout}\n${stderr}`;
    const tag = output.match(/\b0x[0-9a-f]{8}\b/i)?.[0];
    return tag === undefined
      ? { kind: "unknown", diagnostic: `reparse tag was not present in fsutil output: ${output.trim()}` }
      : { kind: "reparse", tag };
  } catch (error) {
    return { kind: "unknown", diagnostic: `reparse tag probe failed: ${formatError(error)}` };
  }
}

export async function defaultReparsePointProbe(target: string): Promise<ReparseProbeResult> {
  return probeWindowsReparsePoint(target);
}
