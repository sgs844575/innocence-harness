import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UI_STATE, UI_STATE_KEY, loadUiState, patchUiState } from "./uiState";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

let storage: Storage;
beforeEach(() => {
  storage = fakeStorage();
});

describe("loadUiState", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadUiState(storage)).toEqual(DEFAULT_UI_STATE);
  });

  it("returns defaults when storage is unavailable", () => {
    expect(loadUiState(undefined)).toEqual(DEFAULT_UI_STATE);
  });

  it("returns defaults for corrupt JSON", () => {
    storage.setItem(UI_STATE_KEY, "{oops");
    expect(loadUiState(storage)).toEqual(DEFAULT_UI_STATE);
  });

  it("falls back per field for missing or wrong-typed values", () => {
    storage.setItem(
      UI_STATE_KEY,
      JSON.stringify({
        lastSessionId: "s-1",
        shellView: "nonsense",
        sidebarOpen: false,
        sidebarSort: 42,
      }),
    );
    expect(loadUiState(storage)).toEqual({
      ...DEFAULT_UI_STATE,
      lastSessionId: "s-1",
      sidebarOpen: false,
    });
  });
});

describe("patchUiState", () => {
  it("merges into the stored snapshot and persists", () => {
    patchUiState({ sidebarView: "groups", terminalPanelOpen: true }, storage);
    patchUiState({ lastSessionId: "s-9" }, storage);
    expect(loadUiState(storage)).toEqual({
      ...DEFAULT_UI_STATE,
      sidebarView: "groups",
      terminalPanelOpen: true,
      lastSessionId: "s-9",
    });
  });

  it("round-trips every field", () => {
    const snapshot = {
      lastSessionId: "s-2",
      shellView: "settings",
      sidebarOpen: false,
      sidebarView: "groups",
      sidebarLayout: "timeline",
      sidebarSort: "created",
      sidebarArchivedOpen: true,
      terminalPanelOpen: true,
    } as const;
    patchUiState(snapshot, storage);
    expect(loadUiState(storage)).toEqual(snapshot);
  });

  it("swallows write failures", () => {
    const broken = {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => patchUiState({ sidebarOpen: false }, broken)).not.toThrow();
  });
});
