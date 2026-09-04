// Transcript DECODING half of the codec (see transcript.ts for the record
// types and encoders). Split by responsibility: this module canonicalizes
// message/part shapes and folds JSONL rows into history + the route map.
import type { TurnCompletion } from "@innocenceharness/harness-providers";
import type { Message, MessagePart, ToolResultPart } from "@innocenceharness/harness-session";
import type { LegacyTurnRecord, SessionMetaRecord, TranscriptRoute, TurnRecordV2, TurnRecordV3 } from "./transcript";

/**
 * A decoded message: the canonical harness shape plus any parts whose type is
 * outside today's vocabulary (e.g. a future attachment part). Unknown-but-legal
 * parts are preserved verbatim on the message — never dropped, and never
 * misclassified as tool parts when canonical blocks are split.
 */
export interface DecodedMessage extends Message {
  readonly preservedParts?: readonly Record<string, unknown>[];
  /** Validated completion attached to the final assistant block of its turn. */
  readonly completion?: TurnCompletion;
}

const KNOWN_PART_TYPES: ReadonlySet<string> = new Set(["text", "thinking", "toolCall", "toolResult"]);
const FINISH_REASONS = new Set(["stop", "length", "content-filter", "tool-calls", "error", "aborted", "other"]);
const USAGE_FIELDS = ["inputTokens", "outputTokens", "totalTokens", "reasoningTokens", "cachedInputTokens"] as const;

/** Reads only the neutral completion DTO; raw provider data is never hydrated. */
function decodeCompletion(raw: unknown): TurnCompletion | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.finishReason !== "string" || !FINISH_REASONS.has(value.finishReason) || typeof value.aborted !== "boolean") {
    return undefined;
  }
  const usageSource = value.usage;
  const usage = typeof usageSource === "object" && usageSource !== null && !Array.isArray(usageSource)
    ? Object.fromEntries(USAGE_FIELDS.flatMap((field) => {
      const count = (usageSource as Record<string, unknown>)[field];
      return typeof count === "number" ? [[field, count]] : [];
    }))
    : undefined;
  return {
    ...(typeof value.providerId === "string" ? { providerId: value.providerId } : {}),
    ...(typeof value.modelId === "string" ? { modelId: value.modelId } : {}),
    ...(usage && Object.keys(usage).length > 0 ? { usage } : {}),
    finishReason: value.finishReason as TurnCompletion["finishReason"],
    aborted: value.aborted,
    ...(typeof value.responseId === "string" ? { responseId: value.responseId } : {}),
  };
}

/** Associates a turn's completion with the last assistant block only. */
function attachCompletion(messages: DecodedMessage[], completion: TurnCompletion | undefined): DecodedMessage[] {
  if (!completion) return messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant") {
      messages[index] = { ...message, completion };
      break;
    }
  }
  return messages;
}

function isKnownPart(raw: unknown): raw is MessagePart {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as { type?: unknown };
  return typeof p.type === "string" && KNOWN_PART_TYPES.has(p.type);
}

/** Unknown-but-legal part: an object with a non-empty string `type` we do not know. */
function isUnknownLegalPart(raw: unknown): raw is Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const type = (raw as { type?: unknown }).type;
  return typeof type === "string" && type.length > 0 && !KNOWN_PART_TYPES.has(type);
}

function validMessage(raw: unknown): raw is { role: "user" | "assistant"; parts: unknown[] } {
  if (typeof raw !== "object" || raw === null) return false;
  const m = raw as { role?: unknown; parts?: unknown };
  return (m.role === "user" || m.role === "assistant") && Array.isArray(m.parts);
}

/** Known parts, plus preserved unknown parts — from the parts array AND from an
 * already-decoded message's `preservedParts` field (re-canonicalization). */
function classifyParts(message: { parts: readonly unknown[]; preservedParts?: unknown }): {
  parts: MessagePart[];
  preserved: Record<string, unknown>[];
} {
  const parts: MessagePart[] = [];
  const preserved: Record<string, unknown>[] = [];
  for (const raw of message.parts) {
    if (isKnownPart(raw)) parts.push(raw);
    else if (isUnknownLegalPart(raw)) preserved.push(raw);
  }
  if (Array.isArray(message.preservedParts)) {
    for (const raw of message.preservedParts) {
      if (isUnknownLegalPart(raw)) preserved.push(raw);
    }
  }
  return { parts, preserved };
}

/**
 * UI history may put toolResult parts inside assistant messages. Convert it
 * back to canonical harness shape: assistant blocks, then user result blocks.
 * Unknown-but-legal parts stay on their original message: they attach to the
 * message's last canonical block (or form a block of their own when the
 * message produced none) and are NEVER treated as tool parts.
 */
export function canonicalizeHistory(rawMessages: readonly unknown[]): DecodedMessage[] {
  const out: DecodedMessage[] = [];
  for (const raw of rawMessages) {
    if (!validMessage(raw)) continue;
    const { parts, preserved } = classifyParts(raw);
    if (parts.length === 0 && preserved.length === 0) continue;
    if (raw.role === "user") {
      out.push(
        preserved.length === 0
          ? { role: "user", parts }
          : { role: "user", parts, preservedParts: preserved.map((p) => ({ ...p })) },
      );
      continue;
    }

    const blocks: DecodedMessage[] = [];
    let assistant: MessagePart[] = [];
    let results: ToolResultPart[] = [];
    const flushAssistant = () => {
      if (assistant.length > 0) blocks.push({ role: "assistant", parts: assistant });
      assistant = [];
    };
    const flushResults = () => {
      if (results.length > 0) blocks.push({ role: "user", parts: results });
      results = [];
    };
    for (const part of parts) {
      if (part.type === "toolResult") {
        flushAssistant();
        results.push(part);
      } else {
        flushResults();
        assistant.push(part);
      }
    }
    flushAssistant();
    flushResults();

    if (blocks.length === 0) {
      blocks.push({ role: "assistant", parts: [], preservedParts: preserved.map((p) => ({ ...p })) });
    } else {
      const last = blocks[blocks.length - 1]!;
      blocks[blocks.length - 1] = { ...last, preservedParts: preserved.map((p) => ({ ...p })) };
    }
    out.push(...blocks);
  }
  return out;
}

function logicalTurns(messages: Message[]): Message[][] {
  const turns: Message[][] = [];
  let current: Message[] = [];
  for (const message of messages) {
    const startsTurn =
      message.role === "user" &&
      message.parts.some((p) => p.type === "text" && p.text.length > 0);
    if (startsTurn && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

function textOf(message: Message): string {
  return message.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
}

/** A legacy record's top-level `user` field identifies the turn persisted by
 * that line. Find the last matching textual user message and take it through
 * the end of the snapshot. This is deterministic across cumulative snapshots,
 * restart fragments, canonical/UI shapes, and repeated identical prompts. */
function legacyCurrentTurn(record: LegacyTurnRecord): Message[] {
  if (!Array.isArray(record.history)) return [];
  const messages = canonicalizeHistory(record.history);
  const marker = typeof record.user === "string" ? record.user : "";
  if (!marker) return logicalTurns(messages).at(-1) ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user" && textOf(message) === marker) {
      return messages.slice(i);
    }
  }
  return logicalTurns(messages).at(-1) ?? [];
}

/** turn-v2 rows (and legacy snapshots) belong to the implicit "main" route. */
const MAIN_ROUTE = "main";

function isTurnRecordV3Shape(record: Record<string, unknown>): boolean {
  return (
    typeof record.turnId === "string" &&
    record.turnId.length > 0 &&
    typeof record.routeId === "string" &&
    record.routeId.length > 0 &&
    typeof record.eventId === "string" &&
    typeof record.checkpointId === "string" &&
    (record.parentTurnId === null || typeof record.parentTurnId === "string") &&
    Array.isArray(record.messages)
  );
}

export interface DecodedTranscript {
  /** Main-route conversation history (v2 rows, v3 "main" rows, legacy snapshots). */
  history: DecodedMessage[];
  /** Route map: v2 rows map to "main"; v3 rows carry explicit route identity. */
  routes: ReadonlyMap<string, TranscriptRoute>;
  /** Last `session-meta` row of the file (self-describing header), if any. */
  meta?: SessionMetaRecord;
  lastAt?: string;
  validRecords: number;
}

/** Internal mutable accumulator entry (narrowed to TranscriptRoute on return). */
interface RouteEntry {
  routeId: string;
  parentTurnId: string | null;
  turnIds: string[];
  messages: DecodedMessage[];
}

function routeOf(routes: Map<string, RouteEntry>, routeId: string, parentTurnId: string | null): RouteEntry {
  let entry = routes.get(routeId);
  if (entry === undefined) {
    entry = { routeId, parentTurnId, turnIds: [], messages: [] };
    routes.set(routeId, entry);
  }
  return entry;
}

/** One turn's folding slot: rows of the same (route, turnId) collapse onto the
 * slot and the LAST row wins — interim snapshots (real-time persistence during
 * a live turn) are replaced by the turn's final row; identical re-appends after
 * a crash stay idempotent. Order of appearance decides the slot's position. */
interface TurnSlot {
  routeId: string;
  parentTurnId: string | null;
  order: number;
  messages: DecodedMessage[];
}

function validMetaRecord(raw: unknown): SessionMetaRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Partial<SessionMetaRecord> & { type?: unknown };
  if (record.type !== "session-meta") return null;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (typeof record.title !== "string" || typeof record.createdAt !== "number") return null;
  return {
    type: "session-meta",
    at: typeof record.at === "string" ? record.at : "",
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    ...(typeof record.workspaceRoot === "string" ? { workspaceRoot: record.workspaceRoot } : {}),
    ...(record.aux === true ? { aux: true } : {}),
    ...(record.forkedFrom && typeof record.forkedFrom === "object" && typeof record.forkedFrom.sessionId === "string"
      ? {
          forkedFrom: {
            sessionId: record.forkedFrom.sessionId,
            ...(typeof record.forkedFrom.messageId === "string" ? { messageId: record.forkedFrom.messageId } : {}),
          },
        }
      : {}),
  };
}

/**
 * Decodes transcript JSONL text. turn-v2 rows and legacy snapshots feed the
 * "main" route history (old lines are read, never rewritten); turn-v3 rows
 * carry explicit route identity, and ancestry is restored through each route's
 * `parentTurnId`. Messages of non-main routes are reachable via the route map
 * and are NOT merged into the main `history`. Rows sharing one (route,
 * turnId) fold with last-wins so real-time interim snapshots never duplicate
 * the turn they precede; `session-meta` header rows are collected the same
 * way (the file describes its own session — the index is a rebuildable cache).
 */
export function decodeTranscript(raw: string): DecodedTranscript {
  const history: DecodedMessage[] = [];
  const routes = new Map<string, RouteEntry>();
  const slots = new Map<string, TurnSlot>();
  const seenRawLines = new Set<string>();
  // Stream-order timeline: turn slots at first appearance, legacy pushes
  // inline — mixed legacy/v2 files keep their historical ordering.
  const timeline: Array<{ turn: string } | { legacy: DecodedMessage[] }> = [];
  let seededLegacy = false;
  let meta: SessionMetaRecord | undefined;
  let lastAt: string | undefined;
  let validRecords = 0;
  let order = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || seenRawLines.has(trimmed)) continue;
    seenRawLines.add(trimmed);
    let parsed: TurnRecordV2 | TurnRecordV3 | LegacyTurnRecord | SessionMetaRecord;
    try {
      parsed = JSON.parse(trimmed) as TurnRecordV2 | TurnRecordV3 | LegacyTurnRecord | SessionMetaRecord;
    } catch {
      continue;
    }
    if (typeof parsed.at === "string") lastAt = parsed.at;

    const metaRecord = validMetaRecord(parsed);
    if (metaRecord) {
      validRecords += 1;
      meta = metaRecord;
      continue;
    }

    if (parsed.type === "turn-v2") {
      const record = parsed as TurnRecordV2;
      if (!Array.isArray(record.messages)) continue;
      validRecords += 1;
      const key = turnSlotKey(MAIN_ROUTE, record.turnId);
      const canonical = attachCompletion(canonicalizeHistory(record.messages), decodeCompletion(record.completion));
      const existing = slots.get(key);
      if (existing) {
        existing.messages = canonical;
      } else {
        slots.set(key, { routeId: MAIN_ROUTE, parentTurnId: null, order: order++, messages: canonical });
        timeline.push({ turn: key });
      }
      continue;
    }

    if (parsed.type === "turn-v3") {
      const record = parsed as unknown as Record<string, unknown>;
      if (!isTurnRecordV3Shape(record)) continue;
      const v3Record = parsed as TurnRecordV3;
      validRecords += 1;
      const key = turnSlotKey(v3Record.routeId, v3Record.turnId);
      const canonical = attachCompletion(canonicalizeHistory(v3Record.messages), decodeCompletion(v3Record.completion));
      const existing = slots.get(key);
      if (existing) {
        existing.messages = canonical;
      } else {
        slots.set(key, { routeId: v3Record.routeId, parentTurnId: v3Record.parentTurnId, order: order++, messages: canonical });
        timeline.push({ turn: key });
      }
      continue;
    }

    const record = parsed as LegacyTurnRecord;
    if (!Array.isArray(record.history)) continue;
    validRecords += 1;
    const allTurns = logicalTurns(canonicalizeHistory(record.history));
    // Legacy runtime persisted only after a model turn completed. A user-only
    // snapshot is a torn/intermediate row, not a completed conversation turn.
    const completed = allTurns.filter((turn) => turn.some((m) => m.role === "assistant"));
    if (completed.length === 0) continue;
    let current: DecodedMessage[];
    if (!seededLegacy) {
      // The first surviving record may already be cumulative (earlier JSONL rows
      // were lost/truncated), so seed every completed turn it contains once.
      current = completed.flat();
      seededLegacy = true;
    } else {
      const tail = legacyCurrentTurn(record);
      current = tail.some((m) => m.role === "assistant") ? tail : [];
    }
    if (current.length > 0) timeline.push({ legacy: current });
  }

  for (const entry of timeline) {
    if ("legacy" in entry) {
      history.push(...entry.legacy);
      continue;
    }
    const slot = slots.get(entry.turn);
    if (!slot) continue;
    const route = routeOf(routes, slot.routeId, slot.parentTurnId);
    route.turnIds.push(slotKeyTurnId(entry.turn));
    route.messages.push(...slot.messages);
    if (slot.routeId === MAIN_ROUTE) {
      history.push(...slot.messages);
    }
  }
  return { history, routes, ...(meta ? { meta } : {}), lastAt, validRecords };
}

/** Slot key separator: NUL never occurs inside route/turn ids. */
const SLOT_SEP = String.fromCharCode(0);

function turnSlotKey(routeId: string, turnId: string): string {
  return routeId + SLOT_SEP + turnId;
}

/** The turn id half of a slot key. */
function slotKeyTurnId(key: string): string {
  return key.slice(key.lastIndexOf(SLOT_SEP) + SLOT_SEP.length);
}
