import type { PermissionRequest, PermissionResource, ToolSideEffect } from "./policy";

/** One recent deny resolution with the complete invocation. */
export interface PermissionDenialNote {
  toolName: string;
  args: Record<string, unknown>;
  resource: PermissionResource;
  via: string;
  reason: string;
}

/**
 * Input handed to a permission classifier at the ask boundary. Everything in
 * here is the complete persisted copy — the same data rules, audit and the
 * human-facing ask already see.
 */
export interface PermissionClassificationInput {
  request: PermissionRequest;
  tool: { readOnly: boolean; sideEffect: ToolSideEffect };
  /** Bounded ring of this session's recent complete deny resolutions (oldest first). */
  recentDenials: readonly PermissionDenialNote[];
}

/** A classifier verdict; `ask` (or no verdict) escalates to the human. */
export interface PermissionClassification {
  decision: "allow" | "deny" | "ask";
  reason: string;
}

/**
 * Optional pre-ask evaluation round (S3 权限分类器). Mounted between the
 * static pipeline and the user ask: `classify` runs ONLY at the ask boundary
 * — static rules keep absolute priority — and any failure must surface as
 * `undefined`/`ask` (fail-closed to the human), never as an allow. The
 * engine additionally swallows thrown errors, so implementations may fail
 * freely.
 */
export interface PermissionClassifier {
  classify(input: PermissionClassificationInput): Promise<PermissionClassification | undefined>;
}
