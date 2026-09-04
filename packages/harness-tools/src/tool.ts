import { createHash } from "node:crypto";
import type { ExecutionScope } from "./execution-scope";
import type { PermissionResource, ToolSideEffect } from "./policy";
import type { JsonSchema } from "./types";
import type { SubagentSpawner } from "./subagent";

export type { ToolSideEffect };

/** 工具结果携带的图像：base64 裸数据（无 data: 前缀），模型可见（视觉闭环）。 */
export interface ToolImage {
  mediaType: string;
  data: string;
}

export interface ToolResult {
  content: string;
  /** 模型可见图像；随结果进历史并映射到 provider，事件/UI 面不携带。 */
  images?: ToolImage[];
  isError?: boolean;
}

export interface ToolContext {
  /** All file-ish tools must confine themselves to this directory. */
  workspaceRoot: string;
  /** Aborted when the user stops the run; long operations should check it. */
  signal: AbortSignal;
  log(level: "info" | "warn" | "error", msg: string, data?: unknown): void;
  /** Provided by the kernel; absent in hosts that don't support subagents. */
  subagent?: SubagentSpawner;
  /**
   * Read-only, per-invocation scope. The executor builds a fresh one (new
   * invocation id) for every tool call; it is never shared or reused.
   */
  readonly scope: ExecutionScope;
}

export interface Tool {
  name: string;
  description: string;
  /** True for tools with no side effects — plan mode auto-allows these. */
  readOnly: boolean;
  /** Coarse side-effect class for audit records and UI hints. */
  sideEffect?: ToolSideEffect;
  /**
   * True for tools whose execution may block indefinitely on a HUMAN response
   * (e.g. a structured question card). The session tool deadline does not
   * apply to them — only the run signal stops the wait (repo discipline: no
   * wall-clock timeout while waiting on the user or a subagent).
   */
  awaitsUser?: boolean;
  parameters: JsonSchema;

  /**
   * Executor chain (fixed order): raw args → validateArgs(raw) →
   * permissionResource(raw) → validateResource(resource) →
   * request / policy / mode / ask / audit → execute(raw). The complete
   * invocation args are used consistently throughout the chain.
   */

  /** Cheap structural validation of RAW args; throws on bad input. */
  validateArgs?(args: Record<string, unknown>): void | Promise<void>;

  /**
   * Canonical resource this call acts on (policy rules and session grants
   * match on it). Built from raw args.
   */
  permissionResource(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): PermissionResource | Promise<PermissionResource>;

  /**
   * Runs the tool. Thrown/reported error messages flow into history and
   * audit, so they should report the failing argument's NAME rather than
   * echoing oversized payloads.
   */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** Stable SHA-256 hex digest. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

