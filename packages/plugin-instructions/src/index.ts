// Workspace instructions plugin: injects the workspace instruction file
// (AGENT.md; case variants and the plural AGENTS.md convention are accepted)
// into the FIRST user turn of every NEW session as a message-side envelope —
// the system prompt is never touched (caching discipline). Factory form (same
// staged shape as the reminders plugin) so the host session composition
// supplies the workspace root and the continuation signal. Continuation
// sessions (rebuilt from a stored transcript seed) skip the injection: their
// stored first turn already carries the envelope.
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

export interface InstructionsPluginOptions {
  /** Workspace root of the session; empty/undefined means no injection. */
  getWorkspaceRoot: () => string | undefined;
  /**
   * True when this session continues stored history (the host rebuilt the
   * session with a transcript seed); the injected envelope is already in the
   * stored first turn, so a fresh injection would duplicate it.
   */
  isContinuationSession?: () => boolean;
}

export interface InstructionsPlugin {
  readonly name: "instructions";
  apply(ctx: Context): void;
}

/**
 * Pipeline position: after the host processors (0) and the early
 * skill-expansion pass (-1000), ahead of the reminders tail (900) — the
 * envelope lands on the same outbound first turn the reminders append to.
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
