import type { Context } from "@innocencecode/kernel";
import type { PermissionAuditor, PermissionDecider, PermissionEngine, PermissionMode, ProjectPermissionConfig, ResourceValidator } from "@innocencecode/harness-permissions";
import type { Provider } from "@innocencecode/harness-providers";
import type { Logger, SessionPlugin } from "./registry";
import type { SessionLoaderPlugin } from "./session-loader";
import type { SessionSpineSuite } from "./session-spine";

export interface AgentSessionOptions {
  plugins: SessionPlugin[];
  loaderEntries?: SessionLoaderPlugin[];
  scope?: { ctx: Context };
  spine?: SessionSpineSuite;
  /** Host policy: this session must receive a dynamically injected spine. */
  requireInjectedSpine?: boolean;
  /** Explicit self-contained/test seam for the bundled static spine. */
  allowStaticSpine?: boolean;
  provider?: Provider;
  providerId?: string;
  workspaceRoot: string;
  systemPrompt?: string;
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
  logger?: Logger;
}

export interface RunSummary {
  turns: number;
  finalText: string;
  aborted: boolean;
}
