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
import fs from "node:fs/promises";
import path from "node:path";
import type { TurnCompletion } from "@innocenceharness/harness-providers";
import type { Message } from "@innocenceharness/harness-session";
import { encodeTurnV2, encodeTurnV3 } from "./transcript";
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

export interface TurnPersistenceOptions {
  /** Transcript directory; null/undefined = no persistence. */
  persistDir?: string;
  /** Failure reporting (persistence is best-effort, never breaks a turn). */
  log: (level: "warn", msg: string, data?: unknown) => void;
}

export async function persistTurn(
  options: TurnPersistenceOptions,
  input: {
    sessionId: string;
    turnId: string;
    routeId: string;
    messages: Message[];
    completion: TurnCompletion;
  },
): Promise<void> {
  const { sessionId, turnId, messages, completion } = input;
  const routeId = input.routeId || DEFAULT_ROUTE_ID;
  if (!options.persistDir || messages.length === 0) return;
  try {
    const file = routeId === DEFAULT_ROUTE_ID
      ? mainTranscriptFile(options.persistDir, sessionId)
      : routeTranscriptFile(options.persistDir, sessionId, routeId);
    if (!file) {
      // Best-effort layer: an unsafe route id skips persistence (warn) but
      // never fails the completed turn.
      options.log("warn", "route transcript skipped: unsafe route id", { sessionId, routeId });
      return;
    }
    await fs.mkdir(options.persistDir, { recursive: true });
    const line =
      routeId === DEFAULT_ROUTE_ID
        ? encodeTurnV2(turnId, new Date().toISOString(), messages, completion)
        : encodeTurnV3({
            at: new Date().toISOString(),
            eventId: nextEventId(),
            turnId,
            routeId,
            parentTurnId: null,
            checkpointId: "",
            messages,
            completion,
          });
    await fs.appendFile(file, line, "utf8");
  } catch (err) {
    options.log("warn", "persist failed", String(err));
  }
}
