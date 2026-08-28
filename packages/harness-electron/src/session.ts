// AgentSession: the host-facing conversational session. The shell API is
// unchanged; internally the session is one kernel Context carrying the spine
// services (tools/permissions/providers/skills/session/system-prompt/agents/
// spawner) with the HarnessPluginAdapter bridging legacy HarnessPlugins onto
// them (see session-kernel.ts / session-adapter.ts / session-registry-view.ts).
// Home: the harness-electron host-adapter package (the Electron shell's
// runtime glue) — the session family moved here when the retired core package
// was deleted; the module itself stays host-agnostic (no Electron imports).
import type { RunLoopFunction } from "@innocenceharness/harness-agent-loop";
import { nextRouteId, nextSessionId, type ExecutionScopeIdentity } from "@innocenceharness/harness-tools";
import type { HarnessEventListener, Message } from "@innocenceharness/harness-session";
import type { PermissionEngine, PermissionMode } from "@innocenceharness/harness-permissions";
import type { Provider } from "@innocenceharness/harness-providers";
import type { ProjectTraits } from "@innocenceharness/harness-system-prompt";
import type { Logger } from "./registry";
import { mountSessionKernel, type SessionKernel } from "./session-kernel";
import type { SessionRegistryView } from "./session-registry-view";
import { createSpawnerChildSession, makeSessionSpawner } from "./session-spawner";
import type { SubagentSpawner } from "@innocenceharness/harness-agent";
import { staticSpineSuite, type SessionSpineSuite } from "./session-spine";
import { canonicalUserMessage, executeSessionRun, settleSessionKernel } from "./session-lifecycle";
import type { AgentSessionOptions, RunSummary } from "./session-options";
export type { AgentSessionOptions, RunSummary } from "./session-options";

const noopLogger: Logger = () => {};


/**
 * Ties the kernel context, spine services, provider, permission engine,
 * compactor and event stream into one conversational session. Hosts
 * (Electron, CLI, tests) subscribe to events and inject the permission
 * decider.
 */
export class AgentSession {
  readonly registry: SessionRegistryView;
  readonly permission: PermissionEngine;
  readonly provider: Provider;
  readonly workspaceRoot: string;
  /** Normalized prompt-assembly inputs (kernel-provided; see SessionKernel). */
  readonly agentMode: string;
  readonly traits: ProjectTraits;
  readonly sessionId: string;
  readonly history: Message[];
  readonly options: AgentSessionOptions;
  readonly loaderEntries: readonly import("@innocenceharness/kernel-loader").LoaderEntry[];

  private readonly kernel: SessionKernel;
  private readonly loop: RunLoopFunction;
  private readonly listeners = new Set<HarnessEventListener>();
  private readonly logger: Logger;
  private abort: AbortController | undefined;
  private activeRun: Promise<unknown> | undefined;
  /** Frozen first system-prompt assembly (see buildSystemPrompt). */
  private assembledPrompt: string | undefined;
  /** Set as soon as dispose() starts: a released session never runs again. */
  private disposed = false;
  private disposeInFlight: Promise<void> | undefined;
  private disposeSettled = false;

  private constructor(
    options: AgentSessionOptions,
    kernel: SessionKernel,
    sessionId: string,
    spine: SessionSpineSuite,
  ) {
    this.options = options;
    this.kernel = kernel;
    this.registry = kernel.view;
    this.permission = kernel.services.permissions.engine;
    this.provider = kernel.provider;
    this.workspaceRoot = options.workspaceRoot;
    this.agentMode = kernel.agentMode;
    this.traits = kernel.traits;
    this.sessionId = sessionId;
    this.history = kernel.services.session.history;
    this.loaderEntries = kernel.loaderEntries;
    this.logger = options.logger ?? noopLogger;
    this.spawner = makeSessionSpawner(kernel.services.spawner, sessionId, kernel.view);
    this.loop = spine.loop.createRunLoop({
      tools: kernel.services.tools,
      permission: this.permission,
      provider: this.provider,
      history: this.history,
      systemPrompt: () => this.buildSystemPrompt(),
      workspaceRoot: this.workspaceRoot,
      onEvent: (event) => kernel.services.session.emit(event),
      compactor: kernel.services.session.compactor,
      spawner: this.spawner,
      maxTurns: options.maxTurns ?? spine.loop.DEFAULT_MAX_TURNS,
      toolTimeoutMs: options.toolTimeoutMs ?? spine.loop.DEFAULT_TOOL_TIMEOUT_MS,
      telemetry: options.telemetry,
    });
    // HarnessEvent traffic flows over the kernel bus: the session service
    // emits, this root-level subscription fans out to the on() listeners and
    // keeps the error-to-logger semantics.
    kernel.ctx.on("harness/event", (event) => {
      for (const listener of this.listeners) listener(event);
      if (event.type === "error") this.logger("error", event.message);
    });
  }

  static async create(options: AgentSessionOptions): Promise<AgentSession> {
    const sessionId = nextSessionId();
    if (!options.spine && (options.requireInjectedSpine || process.env.NODE_ENV === "production" || !options.allowStaticSpine)) {
      throw new Error("production session requires an injected spine suite");
    }
    const spine = options.spine ?? staticSpineSuite();
    const sessionOptions: AgentSessionOptions = { ...options, spine };
    const kernel = await mountSessionKernel({
      sessionId,
      plugins: sessionOptions.plugins,
      loaderEntries: sessionOptions.loaderEntries,
      scope: sessionOptions.scope,
      spine,
      provider: sessionOptions.provider,
      providerId: sessionOptions.providerId,
      workspaceRoot: sessionOptions.workspaceRoot,
      systemPrompt: sessionOptions.systemPrompt,
      agentMode: sessionOptions.agentMode,
      traits: sessionOptions.traits,
      permission: sessionOptions.permission,
      compaction: sessionOptions.compaction,
      logger: sessionOptions.logger ?? noopLogger,
      spawnerSessionFactory: (materials) => createSpawnerChildSession(sessionOptions, materials),
      lifecycle: sessionOptions.lifecycle,
    });
    return new AgentSession(sessionOptions, kernel, sessionId, spine);
  }

  on(listener: HarnessEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSystemPrompt(prompt: string): void {
    this.kernel.services.systemPrompt.setBase(prompt);
    // The base change must reach the next assembly — drop the frozen string.
    this.assembledPrompt = undefined;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permission.setMode(mode);
  }

  /** Base prompt + registered sections + the skills index (descriptions only).
   *  会话内字节冻结：inputs（插件集/模式/特征/技能）在会话生命周期内不变，
   *  首次组装后缓存（缓存纪律——逐轮复用同一前缀）。 */
  private buildSystemPrompt(): string {
    this.assembledPrompt ??= this.kernel.services.systemPrompt.build(
      this.kernel.services.skills.all(),
      { activeMode: this.agentMode, traits: this.traits },
    );
    return this.assembledPrompt;
  }

  /**
   * One user-initiated run. A string input becomes a canonical single-text
   * user message; a Message must already be `role: "user"`. The canonical
   * input is processor-run BEFORE entering the loop ("/name" skill expansion
   * lives in plugin-skills' first-order processor); the tool-result user
   * turns the loop pushes afterwards never pass through processors.
   * `scopePatch` overrides the run's inherited identity
   * (sessionId/taskId/routeId/parentInvocationId) stamped on every tool
   * invocation scope of this run.
   */
  async run(
    input: string | Message,
    signal?: AbortSignal,
    scopePatch: ExecutionScopeIdentity = {},
  ): Promise<RunSummary> {
    if (this.disposed) {
      throw new Error(`会话已释放（${this.sessionId}），不能再运行`);
    }
    const canonical = canonicalUserMessage(input);
    const abort = new AbortController();
    this.abort = abort;
    if (signal) {
      if (signal.aborted) abort.abort();
      else signal.addEventListener("abort", () => abort.abort(), { once: true });
    }
    const sessionId = scopePatch.sessionId ?? this.sessionId;
    const runScope: ExecutionScopeIdentity = {
      sessionId,
      taskId: scopePatch.taskId,
      routeId: scopePatch.routeId ?? nextRouteId(),
      parentInvocationId: scopePatch.parentInvocationId,
    };
    // The run promise is created and published to activeRun synchronously,
    // BEFORE the first await: a dispose() racing the entry phase (message
    // processing) must wait for this run to settle instead of releasing the
    // kernel underneath it.
    const running = executeSessionRun(this.kernel, this.loop, canonical, runScope, abort);
    this.activeRun = running;
    try {
      return await running;
    } finally {
      this.activeRun = undefined;
      this.abort = undefined;
    }
  }

  stop(): void {
    this.abort?.abort();
  }

  /**
   * Aborts the active run, waits for it to settle, then disposes the kernel
   * context (every plugin and effect, reverse activation order). The
   * disposed flag flips first, so run() calls racing this teardown reject
   * with 会话已释放 instead of driving a released kernel. Idempotent:
   * repeat calls join the same cleanup and never replay its outcome.
   */
  async dispose(): Promise<void> {
    if (this.disposeSettled) return;
    if (this.disposeInFlight) return this.disposeInFlight;
    this.disposed = true;
    this.abort?.abort();
    const active = this.activeRun;
    this.disposeInFlight = settleSessionKernel(this.kernel, active);
    try {
      await this.disposeInFlight;
    } finally {
      this.disposeInFlight = undefined;
      this.disposeSettled = true;
    }
  }

  /**
   * Spawns a nested agent session sharing this session's provider, permission
   * engine (so child tool calls hit the same approval flow) and workspace,
   * with its own isolated message history. The child registers the SAME
   * message processors and tool middlewares as this session, and runs under
   * the parent's scope identity with the spawning invocation as
   * parentInvocationId. Concurrency-capped; the child session is disposed in
   * a finally once its run settles.
   */
  readonly spawner: SubagentSpawner;
}

