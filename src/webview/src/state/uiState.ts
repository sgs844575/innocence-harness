// UI chrome state persistence: remembers the last-closed interface state
// (active session, shell view, sidebar mode/sort, terminal panel) in a single
// localStorage entry. Follows the rightDockWidth precedent — renderer-only,
// no IPC; localStorage lives under the redirected ~/.innocence userData root,
// so it survives restarts and packaging. Storage is injectable for tests.

export interface UiState {
  /** Last open conversation; null = landing page. */
  lastSessionId: string | null;
  shellView: "chat" | "settings" | "automation";
  sidebarOpen: boolean;
  sidebarView: "projects" | "groups";
  sidebarLayout: "tree" | "timeline";
  sidebarSort: "updated" | "created";
  sidebarArchivedOpen: boolean;
  terminalPanelOpen: boolean;
}

export const UI_STATE_KEY = "innocence.uiState.v1";

export const DEFAULT_UI_STATE: UiState = {
  lastSessionId: null,
  shellView: "chat",
  sidebarOpen: true,
  sidebarView: "projects",
  sidebarLayout: "tree",
  sidebarSort: "updated",
  sidebarArchivedOpen: false,
  terminalPanelOpen: false,
};

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Field-by-field load: corrupt JSON or absent fields fall back per field. */
export function loadUiState(storage: Storage | undefined = defaultStorage()): UiState {
  if (!storage) return { ...DEFAULT_UI_STATE };
  let raw: unknown;
  try {
    const text = storage.getItem(UI_STATE_KEY);
    if (text === null) return { ...DEFAULT_UI_STATE };
    raw = JSON.parse(text);
  } catch {
    return { ...DEFAULT_UI_STATE };
  }
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_UI_STATE };
  const candidate = raw as Record<string, unknown>;
  const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  return {
    lastSessionId: typeof candidate.lastSessionId === "string" ? candidate.lastSessionId : null,
    shellView: oneOf(candidate.shellView, ["chat", "settings", "automation"], "chat"),
    sidebarOpen: bool(candidate.sidebarOpen, true),
    sidebarView: oneOf(candidate.sidebarView, ["projects", "groups"], "projects"),
    sidebarLayout: oneOf(candidate.sidebarLayout, ["tree", "timeline"], "tree"),
    sidebarSort: oneOf(candidate.sidebarSort, ["updated", "created"], "updated"),
    sidebarArchivedOpen: bool(candidate.sidebarArchivedOpen, false),
    terminalPanelOpen: bool(candidate.terminalPanelOpen, false),
  };
}

/** Read-merge-write one or more fields; write failures are swallowed. */
export function patchUiState(
  patch: Partial<UiState>,
  storage: Storage | undefined = defaultStorage(),
): UiState {
  const next = { ...loadUiState(storage), ...patch };
  try {
    storage?.setItem(UI_STATE_KEY, JSON.stringify(next));
  } catch {
    // Quota/denied storage must never break the UI.
  }
  return next;
}
