export type AutomationCandidate = {
  trigger:
    | { kind: "schedule"; expression: string; everyMs: number }
    | { kind: "idle"; expression: string; idleForMs: number }
    | { kind: "manual"; expression: string };
  actions: { kind: "run-command" | "notify" | "review"; command: string }[];
  constraints: string[];
  reviewSummary: string;
};

export type StoredAutomationCandidate = AutomationCandidate | {
  trigger: { kind: "schedule" | "idle" | "manual"; expression: string };
  actions: { kind: "run-command" | "notify" | "review"; command: string }[];
  constraints: string[];
  reviewSummary: string;
};

export interface AutomationDefinition {
  id: string;
  name: string;
  candidate: StoredAutomationCandidate;
  targetSessionId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export const AutomationIpcChannels = {
  automationCandidate: "automation:candidate",
  automationConfirm: "automation:confirm",
  automationUpdate: "automation:update",
  automationDelete: "automation:delete",
  automationList: "automation:list",
  automationTrigger: "automation:trigger",
} as const;

export interface AutomationCandidateRequest {
  prompt: string;
}

export interface AutomationConfirmRequest {
  candidate: AutomationCandidate;
  name: string;
  targetSessionId?: string;
}

export interface AutomationTriggerRequest {
  id: string;
  trigger: "manual" | "schedule" | "idle";
  sessionId: string;
  taskId?: string;
  routeId: string;
}

export interface AutomationUpdateRequest {
  id: string;
  candidate: AutomationCandidate;
  name: string;
  targetSessionId?: string;
  enabled: boolean;
}

export interface AutomationApi {
  generateAutomationCandidate(prompt: string): Promise<AutomationCandidate>;
  confirmAutomation(request: AutomationConfirmRequest): Promise<AutomationDefinition>;
  updateAutomation(request: AutomationUpdateRequest): Promise<AutomationDefinition>;
  deleteAutomation(id: string): Promise<boolean>;
  listAutomations(): Promise<AutomationDefinition[]>;
  triggerAutomation(request: AutomationTriggerRequest): Promise<void>;
}
