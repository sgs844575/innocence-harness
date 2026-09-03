// Session spawner wiring: adapts the spine SpawnerService into the public
// AgentSession.spawner face, and builds the child sessions it spawns — the
// recursive AgentSession.create adapter (shared provider/engine, inherited
// processors/middlewares in order, parent workspaceRoot closure).
import type { SpawnerChildMaterials, SpawnerChildSession, SubagentChildEventListener, SubagentSpawner } from "@innocenceharness/harness-agent";
import type { SpawnerService } from "@innocenceharness/harness-agent";
import type { MessageProcessor } from "@innocenceharness/harness-session";
import type { HarnessEvent } from "@innocenceharness/harness-session";
import type { ToolExecutionMiddleware } from "@innocenceharness/harness-tools";
import type { Context, ObjectPlugin } from "@innocenceharness/kernel";
import { AgentSession } from "./session";
import type { AgentSessionOptions } from "./session";
import type { SessionRegistryView } from "./session-registry-view";
import { WORKTREE_ISOLATION_FRAGMENT } from "./worktree-fragment";

/** S2a：父会话运行在工作树时，子代理同享隔离纪律片段的内核插件。 */
const worktreeNotesChildPlugin: ObjectPlugin = {
  name: "worktree-isolation-notes",
  apply(ctx: Context) {
    ctx.systemPrompt.registerFragment(WORKTREE_ISOLATION_FRAGMENT);
  },
};

function abortError(): Error {
  const error = new Error("子代理已取消");
  error.name = "AbortError";
  return error;
}

async function createWithSignal(
  create: () => Promise<AgentSession>,
  signal: AbortSignal | undefined,
): Promise<AgentSession> {
  const promise = create();
  if (!signal) return promise;
  if (signal.aborted) {
    promise.then((session) => void session.dispose().catch(() => {}), () => {});
    throw abortError();
  }
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  promise.then((session) => {
    if (signal.aborted) void session.dispose();
  }, () => {});
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * The public spawner member: delegates to the spine SpawnerService, always
 * passing the session's own id as the fallback identity (direct, unbound
 * spawn calls) and the LIVE processor/middleware arrays so the child
 * re-registers exactly what the parent registered, in order.
 */
export function makeSessionSpawner(
  spawnerService: SpawnerService,
  sessionId: string,
  view: SessionRegistryView,
): SubagentSpawner {
  return {
    run: (options) =>
      spawnerService.run({
        ...options,
        sessionId,
        // Live arrays (never snapshots); the mutable-array cast satisfies the
        // service input shape — the service only reads them.
        inherit: {
          processors: view.messageProcessors as MessageProcessor[],
          middlewares: view.toolMiddlewares as ToolExecutionMiddleware[],
        },
      }),
  };
}

/**
 * Spawner child-session factory: the recursive AgentSession adapter. The
 * materials come from the spawner service; workspaceRoot, the permission
 * decider and the spine suite close over the PARENT session's options (the
 * material face does not carry them).
 */
export function createSpawnerChildSession(
  parentOptions: AgentSessionOptions,
  materials: SpawnerChildMaterials,
): Promise<SpawnerChildSession> {
  return createWithSignal(
    () => AgentSession.create({
    plugins: [
      {
        name: "subagent-tools",
        activate: (ctx) => {
          for (const tool of materials.tools) ctx.registerTool(tool);
        },
      },
      {
        // Same registration set as the parent: identical processor and
        // middleware objects, in the parent's registration order.
        name: "subagent-inherit",
        activate: (ctx) => {
          for (const processor of materials.processors) ctx.registerMessageProcessor(processor);
          for (const middleware of materials.middlewares) ctx.registerToolMiddleware(middleware);
        },
      },
      // S2a：父会话运行在工作树时，同工作区的子代理同享隔离纪律片段
      //（general 子代理有写/执行面，正是片段约束的受众）。
      ...(parentOptions.isolatedWorktree ? [worktreeNotesChildPlugin] : []),
    ],
    provider: materials.provider,
    workspaceRoot: parentOptions.workspaceRoot,
    systemPrompt: materials.systemPrompt,
    spine: parentOptions.spine,
    permission: {
      mode: materials.permission.getMode(),
      decider: parentOptions.permission.decider,
      engine: materials.permission, // shared rules, grants and mode
    },
    maxTurns: materials.maxTurns,
    logger: materials.logger,
    lifecycle: parentOptions.lifecycle,
  }),
    materials.signal,
  ).then((child) => {
    // S2b 上下文继承：种子历史压入子账本（浅拷贝 parts，沿用 buildSession
    // 的播种惯用法）——先于首跑，继承简报随任务 prompt 其后到达。
    if (materials.seedHistory?.length) {
      child.history.push(
        ...materials.seedHistory.map((m) => ({ role: m.role, parts: [...m.parts] })),
      );
    }
    return {
      run: (prompt, signal, identity, onEvent?: SubagentChildEventListener) => {
        // toolResult 事件只带 toolCallId：局部记录调用名以补全 result 的工具名。
        const toolNames = new Map<string, string>();
        const unsubscribe = child.on((event: HarnessEvent) => {
          if (event.type === "token") onEvent?.({ type: "text", text: event.text });
          else if (event.type === "toolCall") {
            toolNames.set(event.id, event.call.toolName);
            // Args reach the spawner for one-line title projection; the
            // lifecycle events never carry raw args onward.
            onEvent?.({ type: "toolCall", name: event.call.toolName, args: event.call.args });
          } else if (event.type === "toolResult") {
            onEvent?.({
              type: "toolResult",
              name: toolNames.get(event.toolCallId) ?? event.toolCallId,
              isError: event.isError === true,
              result: event.content,
            });
          } else if (event.type === "error" && event.fatal) onEvent?.({ type: "error", error: event.message });
        });
        return child.run(prompt, signal, identity).then((result) => ({
          finalText: result.finalText,
          turns: result.turns,
          completion: result.completion,
        })).finally(unsubscribe);
      },
      dispose: () => child.dispose(),
    };
  });
}
