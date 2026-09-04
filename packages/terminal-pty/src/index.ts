// @innocenceharness/terminal-pty — route-bound pseudo-terminal sessions.
// Host-agnostic: node-pty only, no Electron/DOM surface. The manager keys
// sessions by taskId+routeId; every event carries the identity triple.
export type {
  PtyExitEvent,
  PtyOutputEvent,
  PtySession,
  PtyEvent,
  PtySessionFactory,
} from "./pty";
export { LivePtySession, PTY_OUTPUT_BUFFER_MAX_CHARS } from "./pty";
export { createPtyManager, type PtyManager, type PtyManagerOptions } from "./manager";
export {
  detectSystemTerminalFont,
  findGitBash,
  resolveCommandShell,
  resolveShellLaunch,
  resolveTerminalFont,
  stripJsonc,
  type ShellLaunch,
  type SystemProbe,
  type TerminalShellChoice,
} from "./systemProfile";
