// Workspace instructions plugin: injects two message-side envelopes into the
// FIRST user turn of every NEW session — an environment header (current
// time, time zone, operating system, and the command shell the Bash tool
// actually uses, resolved from the terminalShell setting) FIRST, then the
// workspace instruction file (AGENT.md; case variants and the plural
// AGENTS.md convention are accepted) — the system prompt is never touched
// (caching discipline). Factory form (same staged shape as the reminders
// plugin) so the host session composition supplies the workspace root, the
// continuation signal, and the command-shell template. Continuation
// sessions (rebuilt from a stored transcript seed) skip both injections:
// their stored first turn already carries the envelopes.
import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "@innocenceharness/kernel";
// Type-only import: also pulls the `ctx.session` service augmentation of
// harness-session into this compilation, mirroring plugin-reminders.
import type { Message, MessageProcessorContext } from "@innocenceharness/harness-session";

/**
 * Candidate file names at the workspace root, first match wins: the singular
 * AGENT.md form is canonical (what the /init skill writes); the plural
 * AGENTS.md convention is accepted read-only so workspaces that already use
 * it still get injection.
 */
export const INSTRUCTION_FILE_CANDIDATES = ["AGENT.md", "agent.md", "AGENTS.md", "agents.md"] as const;

/** Injection budget (bytes): oversized files truncate with a visible note. */
export const INSTRUCTION_MAX_BYTES = 100 * 1024;

/** The command shell template the Bash tool executes commands through
 *  (host-resolved from the terminalShell setting; same shape tools-shell
 *  consumes as `commandShell`). */
export interface CommandShellTemplate {
  file: string;
  args: readonly string[];
}

export interface InstructionsPluginOptions {
  /** Workspace root of the session; empty/undefined means no instruction file. */
  getWorkspaceRoot: () => string | undefined;
  /**
   * True when this session continues stored history (the host rebuilt the
   * session with a transcript seed); the injected envelopes are already in
   * the stored first turn, so fresh injections would duplicate them.
   */
  isContinuationSession?: () => boolean;
  /** The command shell the Bash tool uses; absent = platform-default
   *  expansion (the envelope says so instead of naming a shell). */
  getCommandShell?: () => CommandShellTemplate | undefined;
  /** Clock seam for tests; defaults to the real current time. */
  now?: () => Date;
  /** Platform seam for tests; defaults to the real process platform. */
  platform?: NodeJS.Platform;
}

export interface InstructionsPlugin {
  readonly name: "instructions";
  apply(ctx: Context): void;
}

/**
 * Pipeline position: after the host processors (0) and the early
 * skill-expansion pass (-1000), ahead of the reminders tail (900) — the
 * envelopes land on the same outbound first turn the reminders append to.
 */
const INSTRUCTIONS_PROCESSOR_ORDER = 800;

/** Wraps the file body in the shared message-side envelope shape. */
export function buildInstructionEnvelope(fileName: string, content: string): string {
  return [
    "<system-reminder>",
    `Workspace instructions loaded from ${fileName} at the start of this session:`,
    "",
    content,
    "",
    "</system-reminder>",
  ].join("\n");
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Human label for the process platform (kept neutral, no vendor names). */
export function osLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

/** Syntax hint derived from the resolved shell executable. */
export function describeCommandShell(shell: CommandShellTemplate): string {
  const name = path.basename(shell.file).toLowerCase();
  // powershell/pwsh 判定必须先于 bash/sh：名字里都含 "sh"。
  if (name.includes("powershell") || name.includes("pwsh")) {
    return "PowerShell syntax";
  }
  if (name.includes("bash") || name.includes("sh")) {
    return "bash syntax (POSIX-compatible)";
  }
  if (name.startsWith("cmd")) {
    return "cmd.exe syntax (CMD builtins and %VAR% expansion)";
  }
  if (name.startsWith("wsl")) {
    return "Linux commands inside the WSL bash environment";
  }
  return "unknown shell — verify syntax with a harmless probe before relying on it";
}

/**
 * The environment header injected FIRST on every new session's opening
 * turn: wall-clock time with UTC offset, time zone, operating system, and
 * the exact command shell the Bash tool runs commands through.
 */
export function buildEnvironmentEnvelope(
  now: Date,
  platform: NodeJS.Platform,
  shell: CommandShellTemplate | undefined,
): string {
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const lines = [
    "<system-reminder>",
    "Session environment (captured at the start of this session):",
    `- Time: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ` +
      `(${WEEKDAYS[now.getDay()]}) ${offset}`,
    `- Time zone: ${timeZone}`,
    `- Operating system: ${osLabel(platform)} (${platform})`,
  ];
  if (shell) {
    const invocation = [shell.file, ...shell.args, "<command>"].map((part) =>
      /\s/.test(part) ? `"${part}"` : part,
    ).join(" ");
    lines.push(`- Command shell (used by the Bash tool): ${invocation} — ${describeCommandShell(shell)}`);
  } else {
    lines.push("- Command shell (used by the Bash tool): the platform default shell expansion");
  }
  lines.push("Write shell commands for that shell only.", "</system-reminder>");
  return lines.join("\n");
}

/**
 * Truncates oversized content to the byte budget on a character boundary and
 * appends a note pointing at the Read tool for the remainder.
 */
export function capInstructionContent(content: string, maxBytes: number = INSTRUCTION_MAX_BYTES): string {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
  let clipped = content;
  while (Buffer.byteLength(clipped, "utf8") > maxBytes) {
    clipped = clipped.slice(0, Math.floor(clipped.length * 0.9));
  }
  return `${clipped}\n\n[Truncated: this file exceeds the ${maxBytes}-byte injection budget; read the rest with the Read tool when needed.]`;
}

/**
 * Reads the first existing non-empty instruction file under root. Read
 * failures and missing files yield null (best-effort: a missing instruction
 * file simply means nothing to inject).
 */
export async function readInstructionFile(root: string): Promise<{ fileName: string; content: string } | null> {
  for (const name of INSTRUCTION_FILE_CANDIDATES) {
    const file = path.join(root, name);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    const raw = await fs.readFile(file, "utf8").catch(() => null);
    if (raw === null || raw.trim() === "") continue;
    return { fileName: name, content: raw };
  }
  return null;
}

export function createInstructionsPlugin(options: InstructionsPluginOptions): InstructionsPlugin {
  return {
    name: "instructions",
    apply(ctx) {
      // One attempt per session composition: only the first processed turn
      // decides (inject, or consume the attempt on skip). A file created
      // mid-session is picked up by the NEXT session.
      let attempted = false;
      ctx.session.registerProcessor({
        name: "instructions",
        order: INSTRUCTIONS_PROCESSOR_ORDER,
        // Parent-session only: subagent children inherit the parent's context
        // goals, not the workspace onboarding envelope.
        inheritToSubagents: false,
        async process(message: Message, _context: MessageProcessorContext): Promise<Message> {
          if (attempted) return message;
          attempted = true;
          if (options.isContinuationSession?.()) return message;
          // 环境信封恒在最前：与指令文件是否存在无关（时间/系统/命令行
          // 对每个新会话都是有效上下文）。
          message.parts.push({
            type: "text",
            text: buildEnvironmentEnvelope(
              options.now?.() ?? new Date(),
              options.platform ?? process.platform,
              options.getCommandShell?.(),
            ),
          });
          const root = options.getWorkspaceRoot();
          if (!root) return message;
          const file = await readInstructionFile(root);
          if (!file) return message;
          message.parts.push({
            type: "text",
            text: buildInstructionEnvelope(file.fileName, capInstructionContent(file.content)),
          });
          return message;
        },
      });
    },
  };
}

// Distribution default (kernel-loader unwrapExports convention): the factory,
// so a disk-loaded module resolves to the single entry point hosts configure.
export default createInstructionsPlugin;
