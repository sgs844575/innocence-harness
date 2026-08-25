import fs from "node:fs/promises";
import path from "node:path";
import type { PermissionDecider } from "@innocenceharness/harness-permissions";
import { createProviderPlugin } from "@innocenceharness/harness-providers";
import { createExecutionScope } from "@innocenceharness/harness-tools";
import { AgentSession } from "./session";
import { decodeTranscript } from "./transcript";
import { systemPromptFor } from "./agents";
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

  const decider: PermissionDecider = {
    ask: async (request) => {
      const ask: PermissionAsk = { requestId: host.nextId("perm"), call: request };
      return host.options.hooks.askPermission(sessionId, messageId, ask);
    },
  };

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
        systemPrompt: systemPromptFor(settings.activeAgent ?? "default"),
        permission: {
          mode: settings.permissionMode,
          decider,
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
      });
    };
    const session = await (host.options.agentFactory?.(factoryContext, create) ?? create());
    toolIndex.adopt(session.registry.tools);

    if (cached) {
      session.history.push(
        ...cached.session.history.map((m) => ({ role: m.role, parts: [...m.parts] })),
      );
    } else if (host.options.persistDir && routeId === DEFAULT_ROUTE_ID) {
      try {
        const raw = await fs.readFile(
          path.join(host.options.persistDir, `${sessionId}.jsonl`),
          "utf8",
        );
        const prior = decodeTranscript(raw).history;
        if (prior.length > 0) {
          session.history.push(...prior.map((m) => ({ role: m.role, parts: [...m.parts] })));
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          host.options.hooks.log("warn", "history seed failed", String(err));
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
