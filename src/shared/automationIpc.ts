export interface AutomationCandidate {
  trigger: { kind: "schedule" | "idle" | "manual"; expression: string };
  actions: { kind: "run-command" | "notify" | "review"; command: string }[];
  constraints: string[];
  reviewSummary: string;
}

export interface AutomationDefinition {
  id: string;
  name: string;
  candidate: AutomationCandidate;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export const AutomationIpcChannels = {
  automationCandidate: "automation:candidate",
  automationConfirm: "automation:confirm",
  automationList: "automation:list",
  automationTrigger: "automation:trigger",
} as const;

export interface AutomationCandidateRequest {
  prompt: string;
}

export interface AutomationConfirmRequest {
  candidate: AutomationCandidate;
  name: string;
}

export interface AutomationTriggerRequest {
  id: string;
  trigger: "manual" | "schedule" | "idle";
  sessionId: string;
  taskId?: string;
  routeId: string;
}

export interface AutomationApi {
  generateAutomationCandidate(prompt: string): Promise<AutomationCandidate>;
  confirmAutomation(request: AutomationConfirmRequest): Promise<AutomationDefinition>;
  listAutomations(): Promise<AutomationDefinition[]>;
  triggerAutomation(request: AutomationTriggerRequest): Promise<void>;
}
