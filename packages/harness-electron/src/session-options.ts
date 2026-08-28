import type { Context } from "@innocenceharness/kernel";
import type { PermissionAuditor, PermissionDecider, PermissionEngine, PermissionMode, ProjectPermissionConfig, ResourceValidator } from "@innocenceharness/harness-permissions";
import type { Provider } from "@innocenceharness/harness-providers";
import type { ProjectTraits } from "@innocenceharness/harness-system-prompt";
import type { Logger, SessionPlugin } from "./registry";
import type { SubagentLifecyclePort } from "@innocenceharness/harness-agent";
import type { SessionLoaderPlugin } from "./session-loader";
import type { SessionSpineSuite } from "./session-spine";

import type { TraceAdapter } from "@innocenceharness/harness-ai-runtime";
import type { TurnCompletion } from "@innocenceharness/harness-providers";

export interface AgentSessionOptions {
  plugins: SessionPlugin[];
  loaderEntries?: SessionLoaderPlugin[];
  scope?: { ctx: Context };
  spine?: SessionSpineSuite;
  /** Host policy: this session must receive a dynamically injected spine. */
  requireInjectedSpine?: boolean;
  /**
   * Test-only compatibility seam for self-contained sessions; production still
   * requires an injected spine suite.
   */
  allowStaticSpine?: boolean;
  provider?: Provider;
  providerId?: string;
  workspaceRoot: string;
  systemPrompt?: string;
  /** Active agent mode id for the system-prompt assembly (open plugin set);
   *  omitted normalizes to "default" at the kernel mount. */
  agentMode?: string;
  /** Host-detected project traits feeding conditional prompt fragments. */
  traits?: ProjectTraits;
  permission: {
    mode: PermissionMode;
    decider: PermissionDecider;
    projectConfig?: ProjectPermissionConfig;
    engine?: PermissionEngine;
    validateResource?: ResourceValidator;
    audit?: PermissionAuditor;
  };
  compaction?: Partial<{ maxContextTokens: number; keepRecent: number }>;
  maxTurns?: number;
  toolTimeoutMs?: number;
  /** Optional host-neutral child-agent lifecycle port. */
  lifecycle?: SubagentLifecyclePort;
  /** Optional allow-listed observability port forwarded to the agent loop. */
  telemetry?: TraceAdapter;
  logger?: Logger;
}

export interface RunSummary {
  turns: number;
  finalText: string;
  aborted: boolean;
  completion: TurnCompletion;
}
