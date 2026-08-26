export type SidebarSessionStatus = "running" | "waiting-permission" | "failed";

export type SidebarSessionStatusEvent =
  | { type: "started" | "stream"; sessionId: string }
  | { type: "permission"; sessionId: string }
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

export function reduceSidebarSessionStatuses(
  current: ReadonlyMap<string, SidebarSessionStatus>,
  event: SidebarSessionStatusEvent,
): Map<string, SidebarSessionStatus> {
  const next = new Map(current);
  if (event.type === "started" || event.type === "stream") next.set(event.sessionId, "running");
  else if (event.type === "permission") next.set(event.sessionId, "waiting-permission");
  else if (event.type === "done") next.delete(event.sessionId);
  else next.set(event.sessionId, "failed");
  return next;
}
