import { contextBridge, ipcRenderer } from "electron";
import { COMPUTER_ACTIVITY as channels, type ComputerActivityApi, type ComputerActivityViewState } from "../shared/computerActivity";

const api: ComputerActivityApi = {
  get: () => ipcRenderer.invoke(channels.get),
  onChanged(listener) {
    const handler = (_event: unknown, state: ComputerActivityViewState) => listener(state);
    ipcRenderer.on(channels.changed, handler);
    return () => ipcRenderer.removeListener(channels.changed, handler);
  },
  ready: () => ipcRenderer.send(channels.ready),
  stop: () => ipcRenderer.invoke(channels.stop),
  hover: (inside) => ipcRenderer.send(channels.hover, inside),
};

contextBridge.exposeInMainWorld("computerActivity", api);
