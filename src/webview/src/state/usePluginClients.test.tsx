// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginInventory } from "../../../shared/ipc";
import { createSlotRegistry } from "../slots/registry";

const apiMock = vi.hoisted(() => ({
  getPluginInventory: vi.fn(),
  onPluginsChanged: vi.fn(() => () => {}),
}));
const loadPluginClientsMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../lib/ipc", () => ({ api: apiMock }));
vi.mock("../pluginClient/loader", () => ({
  importSchemeModule: "import-scheme",
  loadPluginClients: loadPluginClientsMock,
}));

import { usePluginClients } from "./usePluginClients";

const inventory: PluginInventory = [
  {
    id: "example",
    title: "Example",
    core: false,
    client: true,
    toggleable: true,
    state: "active",
    via: "default",
  },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePluginClients HMR refresh", () => {
  it("increments the loader revision only for plugins:changed refreshes", async () => {
    apiMock.getPluginInventory.mockResolvedValue(inventory);
    const registry = createSlotRegistry();
    renderHook(() => usePluginClients(registry));

    await waitFor(() => expect(loadPluginClientsMock).toHaveBeenCalled());
    const loadCalls = loadPluginClientsMock.mock.calls as unknown as Array<[{ revision?: number }]>;
    expect(loadCalls.every(([options]) => options.revision === undefined)).toBe(true);

    const onChanged = (apiMock.onPluginsChanged.mock.calls as unknown as Array<[() => void]>)[0][0];
    loadPluginClientsMock.mockClear();
    await act(async () => {
      onChanged();
    });
    await waitFor(() => expect(loadPluginClientsMock).toHaveBeenCalledTimes(1));

    const hmrOptions = (loadPluginClientsMock.mock.calls as unknown as Array<[{
      inventory: PluginInventory;
      registry: ReturnType<typeof createSlotRegistry>;
      importModule: string;
      revision?: number;
    }]>)[0][0];
    expect(hmrOptions).toMatchObject({
      inventory,
      registry,
      importModule: "import-scheme",
      revision: 1,
    });
  });
});
