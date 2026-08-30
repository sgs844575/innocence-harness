import type {
  AskResponse,
  PermissionMode,
  PermissionRequest,
  PermissionResource,
  PolicyRule,
  ToolCallInfo,
  ToolSideEffect,
} from "./policy";
import type {
  PermissionClassification,
  PermissionClassifier,
  PermissionDenialNote,
} from "./classifier";

/** 拒绝环上限：分类器可见的最近拒绝条数（FIFO，防无界增长）。 */
export const RECENT_DENIALS_LIMIT = 8;

export interface PermissionResolution {
  decision: "allow" | "deny";
  /** Which pipeline stage produced the decision (for events/debugging). */
  via:
    | "fullMode"
    | "denyRule"
    | "planMode"
    | "planReadOnly"
    | "allowRule"
    | "autoMode"
    | "sessionGrant"
    | "classifier"
    | "ask"
    | "validateResource";
  reason: string;
}

export interface PermissionDecider {
  ask(request: PermissionRequest): Promise<AskResponse>;
}

/** Hard, host-injected resource validation (e.g. blocked URLs/dirs). Throwing rejects the call. */
export type ResourceValidator = (resource: PermissionResource) => void | Promise<void>;

/** One audit record per resolution — carries the persisted request only. */
export interface PermissionAuditEntry {
  mode: PermissionMode;
  request: PermissionRequest;
  resolution: PermissionResolution;
  tool: { readOnly: boolean; sideEffect: ToolSideEffect };
}

export type PermissionAuditor = (entry: PermissionAuditEntry) => void;

export interface PermissionEngineOptions {
  mode: PermissionMode;
  decider: PermissionDecider;
  /** Used to normalize absolute paths in args to workspace-relative form. */
  workspaceRoot?: string;
  /** Hard resource validation; runs in EVERY mode (full only skips asking). */
  validateResource?: ResourceValidator;
  /** Audit sink; invoked once per resolution with the persisted request. */
  audit?: PermissionAuditor;
  /**
   * Optional ask-boundary evaluation round (S3). Runs only when the static
   * pipeline would ask; see {@link PermissionClassifier} for the contract.
   * Absent = unchanged behavior (every boundary ask goes to the human).
   */
  classifier?: PermissionClassifier;
}

/**
 * Grant key: tool name + canonical resource joined with NUL separators.
 * Session grants therefore never bleed across actions, kinds or scopes.
 */
export function resourceGrantKey(toolName: string, resource: PermissionResource): string {
  return `${toolName}\u0000${resource.action}\u0000${resource.kind}\u0000${resource.scope}`;
}

/**
 * Pipeline (short-circuit; validateResource is the only fail-closed hard gate):
 *   0. validateResource      -> throw = reject（全模式硬校验，fail-closed）
 *   1. full mode             -> ALLOW（完全访问：短路在 deny 规则之前，
 *                                full 模式下 deny 规则不生效，仅跳过询问）
 *   2. any deny rule         -> DENY（仅非 full 模式会执行到这一步）
 *   3. plan mode (未批准)    -> readOnly ? ALLOW : DENY
 *                                （approvePlan() 后跳过本短路，
 *                                  写操作落回 4-7 常规管线；
 *                                  kind plan 资源=批准通道本身，恒跳过本短路）
 *   4. any allow rule        -> ALLOW
 *   5. auto mode             -> ALLOW
 *   6. session grant (resource key) -> ALLOW
 *   7. ask (via injected decider; "allowSession" also writes a grant)
 * Every resolution (including full mode) is audited with the persisted request.
 */
export class PermissionEngine {
  private rules: PolicyRule[] = [];
  private sessionGrants = new Set<string>();
  private mode: PermissionMode;
  /** 计划批准态：置位后 plan 档不再短路，写操作回归常规管线。 */
  private planApproved = false;
  private readonly decider: PermissionDecider;
  private readonly workspaceRoot?: string;
  private readonly validateResource?: ResourceValidator;
  private readonly audit?: PermissionAuditor;
  private readonly classifier?: PermissionClassifier;
  /** 最近拒绝环（S3 规避检测上下文）：持久化安全字段，FIFO 有界。 */
  private recentDenials: PermissionDenialNote[] = [];

  constructor(opts: PermissionEngineOptions) {
    this.mode = opts.mode;
    this.decider = opts.decider;
    this.workspaceRoot = opts.workspaceRoot;
    this.validateResource = opts.validateResource;
    this.audit = opts.audit;
    this.classifier = opts.classifier;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
    // 任何档位切换都复位计划批准态：离开再回 plan 档需重新提交批准。
    this.planApproved = false;
  }

  /**
   * 批准当前计划：仅 plan 档置位，置位后写操作不再被 plan 短路硬拒，
   * 而是落回 allow 规则→auto→sessionGrant→ask 常规管线。
   * 其他档位调用为无操作，防止跨档误解锁（先在别的档调用再切回 plan
   * 不会携带批准态；任何 setMode 也会复位）。
   */
  approvePlan(): void {
    if (this.mode !== "plan") return;
    this.planApproved = true;
  }

  addRules(rules: readonly PolicyRule[]): void {
    this.rules.push(...rules);
  }

  clearRules(): void {
    this.rules = [];
  }

  grantSession(key: string): void {
    this.sessionGrants.add(key);
  }

  async resolve(
    request: PermissionRequest,
    toolMeta: { readOnly: boolean; sideEffect?: ToolSideEffect },
  ): Promise<PermissionResolution> {
    // Hard validation first, in EVERY mode — full mode only skips asking.
    // A rejection is ALSO audited (decision deny, via validateResource) before
    // rethrowing, so the ledger records every gate decision, not just pipeline
    // stages that ran to completion.
    try {
      await this.validateResource?.(request.resource);
    } catch (err) {
      this.audit?.({
        mode: this.mode,
        request,
        resolution: {
          decision: "deny",
          via: "validateResource",
          reason: err instanceof Error ? err.message : String(err),
        },
        tool: { readOnly: toolMeta.readOnly, sideEffect: toolMeta.sideEffect ?? "unknown" },
      });
      this.noteDenial(request, "validateResource", err instanceof Error ? err.message : String(err));
      throw err;
    }

    const resolution = await this.decide(request, toolMeta);
    this.audit?.({
      mode: this.mode,
      request,
      resolution,
      tool: { readOnly: toolMeta.readOnly, sideEffect: toolMeta.sideEffect ?? "unknown" },
    });
    if (resolution.decision === "deny") {
      this.noteDenial(request, resolution.via, resolution.reason);
    }
    return resolution;
  }

  private noteDenial(
    request: PermissionRequest,
    via: PermissionResolution["via"],
    reason: string,
  ): void {
    this.recentDenials.push({
      toolName: request.toolName,
      resource: request.resource,
      via,
      reason,
    });
    if (this.recentDenials.length > RECENT_DENIALS_LIMIT) {
      this.recentDenials.splice(0, this.recentDenials.length - RECENT_DENIALS_LIMIT);
    }
  }

  private async decide(
    request: PermissionRequest,
    toolMeta: { readOnly: boolean; sideEffect?: ToolSideEffect },
  ): Promise<PermissionResolution> {
    const normalized = this.normalize({
      toolName: request.toolName,
      args: request.args,
    });

    // 完全访问：最顶层短路，连项目 deny 规则也放行（UI 明示慎用）。
    if (this.mode === "full") {
      return { decision: "allow", via: "fullMode", reason: "完全访问模式" };
    }

    for (const rule of this.rules) {
      if (rule.match(normalized) === "deny") {
        return { decision: "deny", via: "denyRule", reason: `${rule.name} 命中拒绝规则` };
      }
    }

    // 计划提交资源（kind === "plan"）是批准通道本身：plan 档内跳过整个
    // plan 短路（既不 planReadOnly 放行也不 planMode 硬拒），落回常规管线
    // ——plan 档下终点即 ask，用户在权限卡上的回答就是"批准/拒绝该计划"
    // （与 planApproved 置位后的"落回常规管线"同路径；deny 规则仍在其前）。
    if (
      this.mode === "plan" &&
      !this.planApproved &&
      request.resource.kind !== "plan"
    ) {
      // 计划模式（未批准）= 只读探索自由、写操作硬拒（deny 规则仍优先于本短路）。
      // 批准后（planApproved）不短路：落回 allow 规则→auto→sessionGrant→ask 常规管线。
      if (toolMeta.readOnly) {
        return {
          decision: "allow",
          via: "planReadOnly",
          reason: "计划模式放行只读操作",
        };
      }
      return {
        decision: "deny",
        via: "planMode",
        reason: "计划模式下只允许只读操作，请先给出计划再切换模式执行",
      };
    }

    for (const rule of this.rules) {
      if (rule.match(normalized) === "allow") {
        return { decision: "allow", via: "allowRule", reason: `${rule.name} 命中允许规则` };
      }
    }

    if (this.mode === "auto") {
      return { decision: "allow", via: "autoMode", reason: "自动模式" };
    }

    const key = resourceGrantKey(request.toolName, request.resource);
    if (this.sessionGrants.has(key)) {
      return { decision: "allow", via: "sessionGrant", reason: `会话内已允许 ${key.split("\u0000")[3]}` };
    }

    // S3 评估轮：仅在 ask 边界、静态规则与会话授权之后；分类器抛错/无意见
    // 一律回落用户询问（fail-closed，绝不因分类器故障而放行）。
    if (this.classifier) {
      let classification: PermissionClassification | undefined;
      try {
        classification = await this.classifier.classify({
          request,
          tool: { readOnly: toolMeta.readOnly, sideEffect: toolMeta.sideEffect ?? "unknown" },
          recentDenials: [...this.recentDenials],
        });
      } catch {
        classification = undefined;
      }
      if (classification?.decision === "allow") {
        return { decision: "allow", via: "classifier", reason: classification.reason };
      }
      if (classification?.decision === "deny") {
        return { decision: "deny", via: "classifier", reason: classification.reason };
      }
    }

    const answer = await this.decider.ask(request);
    if (answer === "allow") {
      return { decision: "allow", via: "ask", reason: "用户本次允许" };
    }
    if (answer === "allowSession") {
      this.sessionGrants.add(key);
      return {
        decision: "allow",
        via: "ask",
        reason: `用户允许（会话内 ${key.split("\u0000")[3]}）`,
      };
    }
    return { decision: "deny", via: "ask", reason: "用户拒绝" };
  }

  /** Absolute paths under workspaceRoot become workspace-relative for rule matching. */
  private normalize(call: ToolCallInfo): ToolCallInfo {
    if (!this.workspaceRoot) return call;
    const args = { ...call.args };
    for (const key of ["path", "file_path", "filePath", "absolute_path"]) {
      const v = args[key];
      if (typeof v !== "string") continue;
      let abs = v;
      if (!/^[a-zA-Z]:[\\/]/.test(v) && !v.startsWith("/") && !v.startsWith("\\")) {
        abs = `${this.workspaceRoot}/${v}`;
      }
      const norm = abs.replace(/\\/g, "/").toLowerCase();
      const root = this.workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
      if (norm === root) {
        args[key] = ".";
      } else if (norm.startsWith(`${root}/`)) {
        args[key] = norm.slice(root.length + 1);
      } else {
        // Outside the workspace: keep the absolute form; fs tools will reject
        // escapes themselves, and path rules simply won't match.
        args[key] = abs;
      }
    }
    return { ...call, args };
  }
}
