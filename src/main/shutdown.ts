/**
 * Async-shutdown handshake for Electron's before-quit. The harness owns OS
 * resources (MCP child processes, in-flight builds, pending permission asks)
 * that must be released before the process exits, so the first quit attempt
 * is always preventDefault'ed while the release runs.
 *
 * The started/released split closes the release-window hole: a SECOND quit
 * attempt arriving while the release is still running (e.g. window-all-closed
 * firing app.quit() again) must ALSO be preventDefault'ed, or the process
 * would exit mid-disposeAllRuntime and leak the detached POSIX MCP process
 * group. Only after markReleased() does the gate let a quit through.
 */
export type ShutdownPhase = "start" | "hold" | "release";

export class ShutdownGate {
  private started = false;
  private released = false;

  /**
   * One call per before-quit event; a pure state transition — the caller owns
   * preventDefault and the release work.
   * - "start":   first attempt — caller preventDefaults and starts the release.
   * - "hold":    release already running and not finished — preventDefault again.
   * - "release": release finished — let this quit proceed untouched.
   */
  onBeforeQuit(): ShutdownPhase {
    if (this.released) return "release";
    if (this.started) return "hold";
    this.started = true;
    return "start";
  }

  /** Marks the release complete; every later before-quit passes through. */
  markReleased(): void {
    this.released = true;
  }

  /**
   * True once the first before-quit arrived — the host is on its quit path
   * from there on, through the release and past markReleased (the process
   * is exiting either way). Read-side query for teardown-time consumers:
   * the session-composition stop face skips entirely while this is true so
   * an exiting process never spawns fresh hook children (batch 5 fix 1).
   */
  isShuttingDown(): boolean {
    return this.started;
  }
}

/**
 * The process-wide gate instance: the main entry's before-quit handshake
 * drives it, and the harness glue reads its state when composing sessions
 * (a module-level singleton because the glue's composition root is built
 * at import time, before the entry wires the quit handler — pure state,
 * no side effects at construction).
 */
export const hostShutdownGate = new ShutdownGate();
