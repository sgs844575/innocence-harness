// Turn persistence (split from runtime.ts by responsibility): appends one
// completed turn of a route to the session's JSONL transcript.
//
// TWO-LAYER RELATIONSHIP: this module is the turn TEXT persistence layer —
// its only job is making every route's conversation history (user turns,
// assistant text, tool calls/results) recoverable after a restart. The task
// system (task-workspace: TurnCommitCoordinator, checkpoints, apply/hunk
// review semantics) is a SEPARATE durability layer over the task repository;
// neither layer replaces the other. Task-scoped turns (task/automation/
// teammate routes) are persisted HERE as text because the task commit flow
// owns checkpoint/apply semantics, not session-history recovery — an empty
// checkpointId marks that no checkpoint backs a text-layer row.
//
// File layout: the main route keeps `{sessionId}.jsonl` (turn-v2 rows — host
// hydration depends on that name and shape, byte-identical to the pre-route
// behavior); every other route appends turn-v3 rows with explicit route
// identity to `{sessionId}_{routeId}.jsonl`, so routes never share a file.
// Realtime persistence writes turns INCREMENTALLY: the prompt snapshot and
// the turn's first history row are full snapshots (turn-v2/turn-v3), every
// later boundary appends a turn-delta row carrying only the new messages —
// a turn's transcript cost stays linear in its logical size.
import fs from "node:fs/promises";
import path from "node:path";
import type { TurnCompletion } from "@innocenceharness/harness-providers";
import type { Message } from "@innocenceharness/harness-session";
import type { ContextUsageSnapshot } from "@innocenceharness/harness-context-meter";
import { encodeContextUsage, encodeTurnDelta, encodeTurnV2, encodeTurnV3 } from "./transcript";
import { DEFAULT_ROUTE_ID } from "./runtime-types";

let persistSeq = 0;
const nextEventId = () => `event_${Date.now().toString(36)}_${(persistSeq++).toString(36)}`;

/**
 * A route id must be one safe storage path segment (same shape the task ids
 * use). REJECTED, not rewritten: replacing characters could map two distinct
 * route ids onto one file and cross-write their histories. Production route
 * ids are "main" and minted `route_*` ids, so this is a defensive bound, not
 * an expected branch.
 */
const SAFE_ROUTE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Main-route transcript file of one chat session. */
export function mainTranscriptFile(persistDir: string, sessionId: string): string {
  return path.join(persistDir, `${sessionId}.jsonl`);
}

/**
 * Route-scoped transcript file `{sessionId}_{routeId}.jsonl`, or null when
 * the route id is not a safe single segment (caller skips persistence).
 * Single-sourced with the write path so session seeding reads the exact file
 * this module appends to.
 */
export function routeTranscriptFile(persistDir: string, sessionId: string, routeId: string): string | null {
  if (!SAFE_ROUTE_SEGMENT.test(routeId)) return null;
  return path.join(persistDir, `${sessionId}_${routeId}.jsonl`);
}

/**
 * Route transcript file placed BESIDE a host-resolved main file (date-
 * partitioned sessions tree): routes share the session's directory, with the
 * same safe-segment rule single-sourced above.
 */
export function routeFileBeside(mainFile: string, sessionId: string, routeId: string): string | null {
  if (!SAFE_ROUTE_SEGMENT.test(routeId)) return null;
  return path.join(path.dirname(mainFile), `${sessionId}_${routeId}.jsonl`);
}

export interface TurnPersistenceOptions {
  /** Transcript directory; null/undefined = no persistence. */
  persistDir?: string;
  /**
   * Host-injected transcript file resolver (wins over the flat persistDir
   * layout): the host owns session-file placement (date-partitioned tree) and
   * resolves main and route files alike. Returning null skips persistence.
   */
  fileFor?: (sessionId: string, routeId: string) => string | null;
  /** Failure reporting (persistence is best-effort, never breaks a turn). */
  log: (level: "warn", msg: string, data?: unknown) => void;
}

function resolveTranscriptFile(
  options: TurnPersistenceOptions,
  sessionId: string,
  routeId: string,
): string | null {
  if (options.fileFor) return options.fileFor(sessionId, routeId);
  if (!options.persistDir) return null;
  return routeId === DEFAULT_ROUTE_ID
    ? mainTranscriptFile(options.persistDir, sessionId)
    : routeTranscriptFile(options.persistDir, sessionId, routeId);
}

/**
 * Per-file append chains: best-effort writers (interim snapshots, meter rows,
 * final rows) fire concurrently, and unordered threadpool completion would
 * let rows land out of initiation order. Each writer enqueues its whole
 * mkdir+append SYNCHRONOUSLY at initiation, so "initiated first lands first"
 * stays deterministic; different files stay parallel.
 */
const appendChains = new Map<string, Promise<void>>();

function enqueueAppend(file: string, write: () => Promise<void>): Promise<void> {
  const next = (appendChains.get(file) ?? Promise.resolve()).then(write, write);
  appendChains.set(file, next);
  void next.catch(() => {}).then(() => {
    if (appendChains.get(file) === next) appendChains.delete(file);
  });
  return next;
}

async function appendLine(file: string, line: string): Promise<void> {
  return enqueueAppend(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, line, "utf8");
  });
}

/**
 * Appends one completed turn (or an interim full-turn snapshot) to the
 * session's JSONL transcript. Snapshot rows RESET the turn's accumulated
 * state in the decoder (last-wins); realtime persistence uses them only for
 * the turn's first history row and falls back to them on write failures.
 *
 * Returns true when a row landed on disk, false when persistence is
 * disabled/skipped or the write failed (best-effort: never throws, never
 * fails the turn) — the caller keeps its incremental cursor and retries the
 * same span in its next flush.
 */
export async function persistTurn(
  options: TurnPersistenceOptions,
  input: {
    sessionId: string;
    turnId: string;
    routeId: string;
    messages: Message[];
    /** Present on final rows; interim snapshots omit it (turn still open). */
    completion?: TurnCompletion;
  },
): Promise<boolean> {
  const { sessionId, turnId, messages } = input;
  const routeId = input.routeId || DEFAULT_ROUTE_ID;
  if (messages.length === 0) return false;
  if (!options.persistDir && !options.fileFor) return false;
  try {
    const file = resolveTranscriptFile(options, sessionId, routeId);
    if (!file) {
      // Best-effort layer: an unsafe route id skips persistence (warn) but
      // never fails the completed turn.
      options.log("warn", "route transcript skipped: unsafe route id", { sessionId, routeId });
      return false;
    }
    const line =
      routeId === DEFAULT_ROUTE_ID
        ? encodeTurnV2(turnId, new Date().toISOString(), messages, input.completion)
        : encodeTurnV3({
            at: new Date().toISOString(),
            eventId: nextEventId(),
            turnId,
            routeId,
            parentTurnId: null,
            checkpointId: "",
            messages,
            completion: input.completion,
          });
    await appendLine(file, line);
    return true;
  } catch (err) {
    options.log("warn", "persist failed", String(err));
    return false;
  }
}

/**
 * Real-time interim snapshot of a running turn (same turnId as the eventual
 * final row, no completion — the turn is still open): the user prompt is
 * durable the moment the turn starts. The decoder folds same-turn rows, so
 * the turn's later rows replace/supplement the snapshot and a crash mid-turn
 * still leaves the turn's latest state on disk. Boolean result matches
 * persistTurn's best-effort contract.
 */
export function persistTurnSnapshot(
  options: TurnPersistenceOptions,
  input: {
    sessionId: string;
    turnId: string;
    routeId: string;
    messages: Message[];
  },
): Promise<boolean> {
  return persistTurn(options, input);
}

/**
 * Appends one INCREMENTAL row of a running turn: `appended` carries only the
 * messages added since this turn's previous row (see TurnDeltaRecord). The
 * closing row of a turn carries `completion`; interim rows omit it.
 *
 * Same best-effort contract and boolean result as persistTurn: false means
 * nothing landed and the caller must NOT advance its incremental cursor —
 * the missed span is retried (as part of the next delta) or recovered by a
 * full-turn snapshot flush.
 */
export async function persistTurnDelta(
  options: TurnPersistenceOptions,
  input: {
    sessionId: string;
    turnId: string;
    routeId: string;
    /** Writer-side monotonic sequence (keeps identical-content deltas distinct). */
    seq: number;
    appended: Message[];
    /** Present on the turn's closing row; interim deltas omit it. */
    completion?: TurnCompletion;
  },
): Promise<boolean> {
  const routeId = input.routeId || DEFAULT_ROUTE_ID;
  if (input.appended.length === 0 && input.completion === undefined) return false;
  if (!options.persistDir && !options.fileFor) return false;
  try {
    const file = resolveTranscriptFile(options, input.sessionId, routeId);
    if (!file) {
      options.log("warn", "route transcript skipped: unsafe route id", { sessionId: input.sessionId, routeId });
      return false;
    }
    const line = encodeTurnDelta({
      at: new Date().toISOString(),
      seq: input.seq,
      turnId: input.turnId,
      routeId,
      appended: input.appended,
      ...(input.completion !== undefined ? { completion: input.completion } : {}),
    });
    await appendLine(file, line);
    return true;
  } catch (err) {
    options.log("warn", "persist delta failed", String(err));
    return false;
  }
}

/**
 * Appends one enriched context-usage row to the session's MAIN transcript
 * (metering is only produced on the main route — the caller gates it).
 * Best-effort like every write here: a failure is logged, never thrown.
 */
export async function persistContextUsage(
  options: TurnPersistenceOptions,
  input: { sessionId: string; snapshot: ContextUsageSnapshot },
): Promise<void> {
  if (!options.persistDir && !options.fileFor) return;
  try {
    const file = resolveTranscriptFile(options, input.sessionId, DEFAULT_ROUTE_ID);
    if (!file) return;
    const line = encodeContextUsage(input.snapshot, new Date().toISOString());
    await appendLine(file, line);
  } catch (err) {
    options.log("warn", "context usage persist failed", String(err));
  }
}
