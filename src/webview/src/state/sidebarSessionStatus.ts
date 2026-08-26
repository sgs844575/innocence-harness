export type SidebarSessionStatus = "running" | "waiting-permission" | "failed";

export type SidebarSessionStatusEvent =
  | { type: "started" | "stream"; sessionId: string }
  | { type: "permission"; sessionId: string }
  | { type: "permission-resolved"; sessionId: string; decision: "allow" | "allowSession" | "deny" }
  | { type: "done"; sessionId: string }
  | { type: "error"; sessionId: string };

const eventName = "innocence:sidebar-session-status";

export function emitSidebarSessionStatus(event: SidebarSessionStatusEvent): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<SidebarSessionStatusEvent>(eventName, { detail: event }));
}

export function subscribeSidebarSessionStatus(listener: (event: SidebarSessionStatusEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStatus = (event: Event) => listener((event as CustomEvent<SidebarSessionStatusEvent>).detail);
  window.addEventListener(eventName, onStatus);
  return () => window.removeEventListener(eventName, onStatus);
}
