import fs from "node:fs/promises";
import path from "node:path";
import type { PermissionDecider } from "@innocenceharness/harness-permissions";
import { createProviderPlugin } from "@innocenceharness/harness-providers";
import { createExecutionScope } from "@innocenceharness/harness-tools";
import type { PendingInputMailbox } from "@innocenceharness/harness-agent-loop";
import { AgentSession } from "./session";
import { decodeTranscript } from "./transcript";
import { routeTranscriptFile } from "./turn-persistence";
import { BUILTIN_FALLBACK_PROMPT } from "./agents";
import { RouteSessionCache, sessionDisposedError } from "./route-cache";
import {
  createSessionToolIndex,
  DEFAULT_ROUTE_ID,
  type PermissionAsk,
  type PluginFactoryContext,
  type RuntimeOptions,
} from "./runtime-types";

export interface RouteBuildContext {
  sessionId: string;
  routeId: string;
  taskId: string;
  messageId: string;
}

export interface RuntimeSessionBuildHost {
  readonly options: RuntimeOptions;
  readonly cache: RouteSessionCache;
  readonly buildContexts: Map<string, RouteBuildContext>;
  readonly nextId: (prefix: string) => string;
  settleDispose(key: string, session: AgentSession): Promise<void>;
  /**
   * The route key's steer mailbox (interactionMode "steer"): owned by the
   * runtime, shared by every session build of the key so a settings rebuild
   * keeps the same drain target. Absent = sessions are built without a
   * mailbox and steer sends degrade to queue sends.
   */
  pendingInputsFor?(key: string): PendingInputMailbox;
}

/** Builds one route session, preserving the runtime cache and teardown rules. */
export async function buildSession(host: RuntimeSessionBuildHost, key: string): Promise<AgentSession> {
  const context = host.buildContexts.get(key);
  if (!context) throw sessionDisposedError(key);
  const { sessionId, routeId, taskId, messageId } = context;
  const settings = host.options.settings();
  const settingsKey = JSON.stringify(settings);
  const cached = host.cache.peek(key);
  if (cached && cached.settingsKey === settingsKey) return cached.session;

  const settingsRoot = settings.workspaceRoot || process.cwd();
  const routeRoot = await host.options.workspaceRootFor?.({
    sessionId,
    routeId,
    taskId: taskId || undefined,
    messageId,
  });
  const workspaceRoot = routeRoot || settingsRoot;
  // S2a 工作树会话判定：驱动子代理工厂为派生会话注册隔离纪律片段
  //（父会话自身的片段由组合根按宿主同一判定注册）。
  const isolatedWorktree =
    (await host.options.isolatedWorktreeFor?.({
      sessionId,
      routeId,
      taskId: taskId || undefined,
      messageId,
    })) ?? false;
  // Project traits for the session's effective workspace (route-resolved):
  // feeds the conditional prompt fragments; no hook = empty traits.
  const traits = (await host.options.projectTraitsFor?.(workspaceRoot)) ?? {};

  const decider: PermissionDecider = {
    ask: async (request) => {
      const ask: PermissionAsk = { requestId: host.nextId("perm"), call: request };
      return host.options.hooks.askPermission(sessionId, messageId, ask);
    },
  };

  // S3 权限分类器：宿主工厂按当次 settings 快照决定是否武装 ask 边界评估轮。
  const permissionClassifier = host.options.permissionClassifierFor?.(settings);

  const toolIndex = createSessionToolIndex();
  const scope = host.options.sessionScope ? await host.options.sessionScope() : undefined;
  const spine = host.options.sessionSpine ? await host.options.sessionSpine() : undefined;
  try {
    const factoryContext: PluginFactoryContext = {
      sessionId,
      routeId,
      taskId: taskId || undefined,
      messageId,
      settings,
      workspaceRoot,
      scope: createExecutionScope("session", undefined, {
        sessionId,
        routeId,
        ...(taskId ? { taskId } : {}),
      }),
      toolIndex,
    };
    const plugins = await host.options.pluginsForSession(factoryContext);
    const create = () => {
      const providerFactory = host.options.providerFactory;
      const sessionPlugins = providerFactory
        ? [...plugins, createProviderPlugin(providerFactory(settings))]
        : plugins;
      return AgentSession.create({
        plugins: sessionPlugins,
        ...(scope ? { scope } : {}),
        ...(spine ? { spine } : {}),
        ...(host.options.sessionSpine ? { requireInjectedSpine: true } : {}),
        workspaceRoot,
        systemPrompt: BUILTIN_FALLBACK_PROMPT,
        agentMode: settings.activeAgentMode ?? "default",
        traits,
        ...(isolatedWorktree ? { isolatedWorktree: true } : {}),
        permission: {
          mode: settings.permissionMode,
          decider,
          ...(permissionClassifier ? { classifier: permissionClassifier } : {}),
          audit: (entry) => {
            host.options.hooks.log("info", "permission", {
              mode: entry.mode,
              tool: entry.request.toolName,
              resource: `${entry.request.resource.action}:${entry.request.resource.kind}:${entry.request.resource.scope}`,
              decision: entry.resolution.decision,
              via: entry.resolution.via,
            });
          },
        },
        logger: (level, msg, data) => host.options.hooks.log(level, msg, data),
        telemetry: host.options.telemetry,
        lifecycle: host.options.hooks.onSubagentLifecycle
          ? { emit: host.options.hooks.onSubagentLifecycle }
          : undefined,
        ...(host.pendingInputsFor ? { pendingInputs: host.pendingInputsFor(key) } : {}),
      });
    };
    const session = await (host.options.agentFactory?.(factoryContext, create) ?? create());
    toolIndex.adopt(session.registry.tools);

    if (cached) {
      session.history.push(
        ...cached.session.history.map((m) => ({ role: m.role, parts: [...m.parts] })),
      );
    } else {
      // History seeding (text layer — the recovery contract): a route replays
      // its own transcript file, resolved through the host's placement port
      // when present (date-partitioned sessions tree) or the flat persistDir
      // layout otherwise. An unsafe route id has no file to seed from (the
      // writer skipped it too).
      const seedFile = host.options.transcriptFileFor
        ? host.options.transcriptFileFor(sessionId, routeId)
        : host.options.persistDir
          ? routeId === DEFAULT_ROUTE_ID
            ? path.join(host.options.persistDir, `${sessionId}.jsonl`)
            : routeTranscriptFile(host.options.persistDir, sessionId, routeId)
          : null;
      if (seedFile) {
        try {
          const raw = await fs.readFile(seedFile, "utf8");
          const decoded = decodeTranscript(raw);
          const prior = routeId === DEFAULT_ROUTE_ID
            ? decoded.history
            : decoded.routes.get(routeId)?.messages ?? [];
          if (prior.length > 0) {
            session.history.push(...prior.map((m) => ({ role: m.role, parts: [...m.parts] })));
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            host.options.hooks.log("warn", "history seed failed", String(err));
          }
        }
      }
    }
    if (host.cache.isDisposing(key)) {
      await host.cache.releaseInPlace(key, session);
      throw sessionDisposedError(key);
    }
    host.cache.commit(key, settingsKey, session);
    if (cached) await host.settleDispose(key, cached.session);
    return session;
  } catch (err) {
    await scope?.dispose().catch(() => {});
    throw err;
  }
}
