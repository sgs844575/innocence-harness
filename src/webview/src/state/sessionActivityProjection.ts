import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/ipc";
import type { SubagentLifecycleEvent } from "../../../shared/ipc";
import type { SidebarSessionStatusEvent } from "./sidebarSessionStatus";
import { subscribeSidebarSessionStatus } from "./sidebarSessionStatus";

export type SessionActivityStatus = "idle" | "running" | "waiting-permission" | "failed" | "archived";

export interface SubagentProjection {
  childId: string;
  parentSessionId: string;
  description: string;
  status: SubagentLifecycleEvent["status"];
  text: string;
  error?: string;
}

export type SubagentProjectionMap = ReadonlyMap<string, SubagentProjection>;

export function subagentKey(parentSessionId: string, childId: string): string {
  return `${parentSessionId}:${childId}`;
}

export function reduceSubagentLifecycle(
  current: SubagentProjectionMap,
  event: SubagentLifecycleEvent,
): Map<string, SubagentProjection> {
  const next = new Map(current);
  const key = subagentKey(event.parentSessionId, event.childId);
  const previous = next.get(key);
  const text = event.final !== undefined
    ? event.final
    : event.delta !== undefined
      ? (previous?.text ?? "") + event.delta
      : previous?.text ?? "";
  next.set(key, {
    childId: event.childId,
    parentSessionId: event.parentSessionId,
    description: event.description,
    status: event.status,
    text,
    ...(event.error !== undefined ? { error: event.error } : previous?.error !== undefined ? { error: previous.error } : {}),
  });
  return next;
}

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
  else if (event.type === "permission-resolved") next.set(event.sessionId, event.decision === "deny" ? "failed" : "running");
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
  subagents: SubagentProjectionMap;
} {
  const [statuses, setStatuses] = useState<Map<string, SessionActivityStatus>>(() => new Map());
  const [subagents, setSubagents] = useState<Map<string, SubagentProjection>>(() => new Map());

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
    const offSubagent = api.onSubagentLifecycle((event) => {
      setSubagents((previous) => reduceSubagentLifecycle(previous, event));
    });
    return () => {
      offLocal();
      offDelta();
      offTool();
      offThinking();
      offPermission();
      offDone();
      offError();
      offSubagent();
    };
  }, []);

  useEffect(() => {
    const validIds = new Set(sessionIds);
    setStatuses((previous) => new Map([...previous].filter(([id]) => validIds.has(id))));
    setSubagents((previous) => new Map([...previous].filter(([, child]) => validIds.has(child.parentSessionId))));
  }, [sessionIds]);

  const status = useMemo(() => sessionActivityStatus(statuses, sessionId, archived), [statuses, sessionId, archived]);
  return { statuses, status, subagents };
}
