import type { ShellTranscriptEvent } from "../../../../shared/terminalIpc";
export type { ShellTranscriptEvent } from "../../../../shared/terminalIpc";

// xterm, no React, no IPC: fully testable in Node. The panel owns xterm
// instances and event subscriptions; this module only tracks WHICH
// terminals exist, which route is active, and which entries went stale
// (旧路线) or exited (已退出).
//
// Invariant: an entry is "stale" when its (taskId, routeId) pair is not the
// active route — a stale terminal is never reused for the new route's cwd;
// the user closes it explicitly.

export interface TerminalRouteRef {
  readonly taskId: string;
  readonly routeId: string;
}

export interface TerminalEntryState {
  readonly ptyId: string;
  readonly taskId: string;
  readonly routeId: string;
  /** 旧路线 — this route is no longer active; close-only, never reused. */
  readonly stale: boolean;
  /** The shell exited; the tab stays until the user closes it. */
  readonly exited: boolean;
  readonly exitCode: number | null;
}

export interface ShellTranscriptState {
  readonly id: string;
  readonly sessionId: string;
  readonly taskId: string;
  readonly routeId: string;
  readonly invocationId: string;
  readonly ptyId?: string;
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly completed: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly error?: string;
}

export interface TerminalCollectionState {
  /** Insertion order of ptyIds (oldest first). */
  readonly order: readonly string[];
  readonly entries: Readonly<Record<string, TerminalEntryState>>;
  readonly activePtyId: string | null;
  readonly shellOrder: readonly string[];
  readonly shellEntries: Readonly<Record<string, ShellTranscriptState>>;
  readonly activeShellId: string | null;
  readonly activePane: "pty" | "shell" | null;
}

export const emptyTerminalState: TerminalCollectionState = {
  order: [],
  entries: {},
  activePtyId: null,
  shellOrder: [],
  shellEntries: {},
  activeShellId: null,
  activePane: null,
};

/** Stale = entry's route is not the active route (null active = all stale). */
export function terminalIsStale(
  entry: Pick<TerminalEntryState, "taskId" | "routeId">,
  active: TerminalRouteRef | null,
): boolean {
  if (!active) return true;
  return entry.taskId !== active.taskId || entry.routeId !== active.routeId;
}

export const MAX_SHELL_TRANSCRIPT_ENTRIES = 100;
export const MAX_SHELL_TRANSCRIPT_OUTPUT_CHARS = 100_000;

function trimTranscriptOutput(value: string): string {
  return value.length > MAX_SHELL_TRANSCRIPT_OUTPUT_CHARS
    ? value.slice(value.length - MAX_SHELL_TRANSCRIPT_OUTPUT_CHARS)
    : value;
}

function limitShellEntries(
  order: readonly string[],
  entries: Readonly<Record<string, ShellTranscriptState>>,
): { order: readonly string[]; entries: Readonly<Record<string, ShellTranscriptState>> } {
  if (order.length <= MAX_SHELL_TRANSCRIPT_ENTRIES) return { order, entries };
  const nextOrder = [...order];
  const nextEntries = { ...entries };
  while (nextOrder.length > MAX_SHELL_TRANSCRIPT_ENTRIES) {
    const candidate = nextOrder.find((id) => nextEntries[id]?.completed) ?? nextOrder[0];
    if (!candidate) break;
    delete nextEntries[candidate];
    nextOrder.splice(nextOrder.indexOf(candidate), 1);
  }
  return { order: nextOrder, entries: nextEntries };
}

export function applyShellTranscriptEvent(
  state: TerminalCollectionState,
  event: ShellTranscriptEvent,
): TerminalCollectionState {
  const id = event.invocationId;
  const current = state.shellEntries[id];
  if (event.type === "started") {
    if (current) return state;
    const entry: ShellTranscriptState = {
      id,
      sessionId: event.sessionId,
      taskId: event.taskId,
      routeId: event.routeId,
      invocationId: event.invocationId,
      ...(event.ptyId ? { ptyId: event.ptyId } : {}),
      command: event.command,
      stdout: "",
      stderr: "",
      completed: false,
      exitCode: null,
      timedOut: false,
    };
    const next = limitShellEntries(
      [...state.shellOrder, id],
      { ...state.shellEntries, [id]: entry },
    );
    return {
      ...state,
      shellOrder: next.order,
      shellEntries: next.entries,
      activePtyId: state.activePtyId,
      activeShellId: id,
      activePane: entry.ptyId === undefined ? "shell" : state.activePane,
    };
  }
  if (!current) return state;
  if (event.type === "output") {
    const output = trimTranscriptOutput(current[event.stream] + event.data);
    return {
      ...state,
      shellEntries: {
        ...state.shellEntries,
        [id]: { ...current, [event.stream]: output },
      },
    };
  }
  return {
    ...state,
    shellEntries: {
      ...state.shellEntries,
      [id]: {
        ...current,
        completed: true,
        exitCode: event.exitCode,
        timedOut: event.timedOut,
        ...(event.error ? { error: event.error } : {}),
      },
    },
  };
}

export function addTerminal(
  state: TerminalCollectionState,
  created: TerminalRouteRef & { ptyId: string },
  active: TerminalRouteRef | null,
): TerminalCollectionState {
  if (state.entries[created.ptyId]) return state;
  const entry: TerminalEntryState = {
    ptyId: created.ptyId,
    taskId: created.taskId,
    routeId: created.routeId,
    stale: terminalIsStale(created, active),
    exited: false,
    exitCode: null,
  };
  return {
    ...state,
    order: [...state.order, created.ptyId],
    entries: { ...state.entries, [created.ptyId]: entry },
    activePtyId: created.ptyId,
    activePane: "pty",
  };
}

/** Recomputes staleness after the active route changed. */
export function markStaleRoutes(
  state: TerminalCollectionState,
  active: TerminalRouteRef | null,
): TerminalCollectionState {
  let changed = false;
  const entries: Record<string, TerminalEntryState> = {};
  for (const ptyId of state.order) {
    const entry = state.entries[ptyId];
    const stale = terminalIsStale(entry, active);
    if (stale !== entry.stale) changed = true;
    entries[ptyId] = stale === entry.stale ? entry : { ...entry, stale };
  }
  return changed ? { ...state, entries } : state;
}

export function markTerminalExited(
  state: TerminalCollectionState,
  ptyId: string,
  exitCode: number | null,
): TerminalCollectionState {
  const entry = state.entries[ptyId];
  if (!entry || entry.exited) return state;
  return {
    ...state,
    entries: { ...state.entries, [ptyId]: { ...entry, exited: true, exitCode } },
  };
}

/** Picks the next active terminal: newest live non-stale, else newest remaining. */
function nextActive(order: readonly string[], entries: Readonly<Record<string, TerminalEntryState>>): string | null {
  const ids = [...order].reverse();
  return ids.find((id) => !entries[id].stale && !entries[id].exited) ?? ids[0] ?? null;
}

export function removeTerminal(state: TerminalCollectionState, ptyId: string): TerminalCollectionState {
  if (!state.entries[ptyId]) return state;
  const entries = { ...state.entries };
  delete entries[ptyId];
  const order = state.order.filter((id) => id !== ptyId);
  return {
    ...state,
    order,
    entries,
    activePtyId: state.activePtyId === ptyId ? nextActive(order, entries) : state.activePtyId,
    activePane: state.activePtyId === ptyId ? "pty" : state.activePane,
  };
}

export function setActiveTerminal(
  state: TerminalCollectionState,
  ptyId: string,
): TerminalCollectionState {
  if (!state.entries[ptyId]) return state;
  if (state.activePtyId === ptyId && state.activePane === "pty") return state;
  return { ...state, activePtyId: ptyId, activePane: "pty" };
}

export function setActiveShell(
  state: TerminalCollectionState,
  shellId: string,
): TerminalCollectionState {
  if (!state.shellEntries[shellId] || state.activeShellId === shellId) return state;
  return { ...state, activeShellId: shellId, activePane: "shell" };
}
