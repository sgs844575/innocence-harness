// Transcript JSONL codec — record types and ENCODERS. Decoding (legacy
// canonicalization, v2/v3 route-aware folding) lives in transcript-decode.ts;
// this split keeps each module under the ~250-300 line responsibility budget.
// New records are append-only turn-v3 rows; turn-v2 rows remain encodable for
// hosts that have not adopted routes yet; legacy records are full-history
// snapshots.
import type { TurnCompletion } from "@innocenceharness/harness-providers";
import type { Message } from "@innocenceharness/harness-session";
import { canonicalizeHistory, type DecodedMessage } from "./transcript-decode";

export {
  canonicalizeHistory,
  decodeTranscript,
  type DecodedMessage,
  type DecodedTranscript,
} from "./transcript-decode";

export interface TurnRecordV2 {
  at: string;
  type: "turn-v2";
  turnId: string;
  messages: Message[];
  /** Optional for backward-compatible append-only metadata storage. */
  completion?: TurnCompletion;
}

/** One committed conversation turn with explicit route identity and ancestry. */
export interface TurnRecordV3 {
  type: "turn-v3";
  at: string;
  eventId: string;
  turnId: string;
  routeId: string;
  parentTurnId: string | null;
  checkpointId: string;
  messages: Message[];
  /** Optional for backward-compatible append-only metadata storage. */
  completion?: TurnCompletion;
}

/** Route view recovered from the transcript: v2 rows map to "main". */
export interface TranscriptRoute {
  routeId: string;
  parentTurnId: string | null;
  turnIds: readonly string[];
  /** The route's own decoded messages (v2 rows feed "main"): what a
   * route-scoped session seeds its agent history from. */
  messages: readonly DecodedMessage[];
}

/** Raw shape of a legacy full-history snapshot row (decoding only). */
export interface LegacyTurnRecord {
  at?: unknown;
  type?: unknown;
  user?: unknown;
  history?: unknown;
}

export function encodeTurnV2(
  turnId: string,
  at: string,
  messages: Message[],
  completion?: TurnCompletion,
): string {
  const record: TurnRecordV2 = {
    at,
    type: "turn-v2",
    turnId,
    messages: canonicalizeHistory(messages),
    ...(completion ? { completion } : {}),
  };
  return `${JSON.stringify(record)}\n`;
}

export interface TurnRecordV3Input {
  at: string;
  eventId: string;
  turnId: string;
  routeId: string;
  parentTurnId: string | null;
  checkpointId: string;
  /** Accepts plain Message[] or already-decoded messages with preservedParts. */
  messages: readonly DecodedMessage[];
  /** Optional for backward-compatible append-only metadata storage. */
  completion?: TurnCompletion;
}

/** Encodes one turn-v3 line; preserved unknown parts survive re-encoding. */
export function encodeTurnV3(input: TurnRecordV3Input): string {
  const record: TurnRecordV3 = {
    type: "turn-v3",
    at: input.at,
    eventId: input.eventId,
    turnId: input.turnId,
    routeId: input.routeId,
    parentTurnId: input.parentTurnId,
    checkpointId: input.checkpointId,
    messages: canonicalizeHistory(input.messages),
    ...(input.completion ? { completion: input.completion } : {}),
  };
  return `${JSON.stringify(record)}\n`;
}
