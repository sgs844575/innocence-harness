import type { ComputerActivitySnapshot } from "@innocenceharness/tools-computer/activity";

export interface ComputerActivityViewState {
  activity: ComputerActivitySnapshot | null;
  theme: "dark" | "light";
  locale: string;
}

export const COMPUTER_ACTIVITY = {
  get: "computer-activity:get",
  changed: "computer-activity:changed",
  ready: "computer-activity:ready",
  stop: "computer-activity:stop",
  hover: "computer-activity:hover",
} as const;

export interface ComputerActivityApi {
  get(): Promise<ComputerActivityViewState>;
  onChanged(listener: (state: ComputerActivityViewState) => void): () => void;
  ready(): void;
  stop(): Promise<void>;
  hover(inside: boolean): void;
}

declare global {
  interface Window { computerActivity?: ComputerActivityApi }
}
