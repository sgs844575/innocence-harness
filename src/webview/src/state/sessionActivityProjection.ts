import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/ipc";
import type { SidebarSessionStatusEvent } from "./sidebarSessionStatus";
import { subscribeSidebarSessionStatus } from "./sidebarSessionStatus";

export type SessionActivityStatus = "idle" | "running" | "waiting-permission" | "failed" | "archived";

export function reduceSessionActivity(
  current: ReadonlyMap<string, SessionActivityStatus>,
  event: SidebarSessionStatusEvent,
): Map<string, SessionActivityStatus> {
  const next = new Map(current);
  if (event.type === "started") next.set(event.sessionId, "running");
  else if (event.type === "stream") {
    if (next.get(event.sessionId) !== "waiting-permission") next.set(event.sessionId, "running");
  }
  else if (event.type === "permission") next.set(event.sessionId, "waiting-permission");
  else if (event.type === "done") next.set(event.sessionId, "idle");
  else next.set(event.sessionId, "failed");
  return next;
}

export function sessionActivityStatus(
  state: ReadonlyMap<string, SessionActivityStatus>,
  sessionId: string | null,
  archived = false,
): SessionActivityStatus {
  if (sessionId === null) return "idle";
  if (archived) return "archived";
  return state.get(sessionId) ?? "idle";
}

export function useSessionActivityProjection(
  sessionId: string | null,
  archived: boolean,
  sessionIds: readonly string[],
): {
  statuses: ReadonlyMap<string, SessionActivityStatus>;
  status: SessionActivityStatus;
} {
  const [statuses, setStatuses] = useState<Map<string, SessionActivityStatus>>(() => new Map());

  useEffect(() => {
    const apply = (event: SidebarSessionStatusEvent) => {
      setStatuses((previous) => reduceSessionActivity(previous, event));
    };
    const offLocal = subscribeSidebarSessionStatus(apply);
    const offDelta = api.onChatDelta((event) => apply({ type: "stream", sessionId: event.sessionId }));
    const offTool = api.onChatTool((event) => apply({ type: "stream", sessionId: event.sessionId }));
    const offThinking = api.onChatThinking((event) => apply({ type: "stream", sessionId: event.sessionId }));
    const offPermission = api.onChatPermission((event) => apply({ type: "permission", sessionId: event.sessionId }));
    const offDone = api.onChatDone((event) => apply({ type: "done", sessionId: event.sessionId }));
    const offError = api.onChatError((event) => apply({ type: "error", sessionId: event.sessionId }));
    return () => {
      offLocal();
      offDelta();
      offTool();
      offThinking();
      offPermission();
      offDone();
      offError();
    };
  }, []);

  useEffect(() => {
    const validIds = new Set(sessionIds);
    setStatuses((previous) => new Map([...previous].filter(([id]) => validIds.has(id))));
  }, [sessionIds]);

  const status = useMemo(() => sessionActivityStatus(statuses, sessionId, archived), [statuses, sessionId, archived]);
  return { statuses, status };
}
