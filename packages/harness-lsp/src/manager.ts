// 语言服务器会话管理（语言服务器波）：按 (workspaceRoot, serverId) 键的
// 客户端注册表（pty manager 的键控会话纪律）：每根每服务器一个长驻子进
// 程，创建串行化，诊断以 publishDiagnostics 的最新快照存储（每 URI 一
// 份全量数组——LSP 语义即全量替换）。didOpen 后的"首份诊断落定"用一次
// 性等待者实现（服务器对每个打开文件至少回发一次快照，空数组也算），
// 附整体收敛上限：超时按当前已存快照返回，不是失败。
import path from "node:path";
import { readFile } from "node:fs/promises";
import { LspClient, type LspServerOptions, type SpawnFn } from "./client";
import { diagnosticFingerprint, pathToUri, projectDiagnostics, uriToPath, type DiagnosticNote } from "./diagnostics";

/** 一个语言服务器声明：命令 + 承接的扩展名集（小写、含点）。 */
export interface LspServerDescriptor extends LspServerOptions {
  id: string;
  /** 承接的文件扩展名（小写含点，如 [".ts", ".tsx"]）。 */
  extensions: string[];
}

export function normalizeServerDescriptor(raw: unknown): LspServerDescriptor | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const id = record.id;
  const command = record.command;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
  if (typeof command !== "string" || command.trim() === "") return undefined;
  const extensions = Array.isArray(record.extensions)
    ? record.extensions.filter((value): value is string => typeof value === "string")
        .map((value) => value.toLowerCase())
        .map((value) => (value.startsWith(".") ? value : `.${value}`))
    : [];
  if (extensions.length === 0) return undefined;
  const args = Array.isArray(record.args)
    ? record.args.filter((value): value is string => typeof value === "string")
    : undefined;
  const env = record.env && typeof record.env === "object" && !Array.isArray(record.env)
    ? Object.fromEntries(
        Object.entries(record.env as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : undefined;
  return {
    id,
    command: command.trim(),
    ...(args !== undefined && args.length > 0 ? { args } : {}),
    ...(env !== undefined ? { env } : {}),
    extensions,
  };
}

/** 单文件诊断查询的收敛上限：超过按已存快照返回（不是失败）。 */
export const DIAGNOSTIC_SETTLE_MS = 3_000;
/** 读取文件文本的大小上限（与 codeReader 的读取上限同量级）。 */
const MAX_OPEN_BYTES = 2_000_000;

interface SessionWaiter {
  uri: string;
  resolve: (notes: DiagnosticNote[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ClientSession {
  client: LspClient;
  descriptor: LspServerDescriptor;
  diagnostics: Map<string, DiagnosticNote[]>;
  openFiles: Set<string>;
}

export interface LspManagerEvents {
  /** 诊断快照更新（每次 publishDiagnostics 后触发，含空快照）。 */
  onDiagnostics?: (root: string, notes: readonly DiagnosticNote[]) => void;
  /** 服务器启动/退出审计面。 */
  log?: (level: "info" | "warn", message: string) => void;
}

export interface LspManager {
  /** 打开（或复用）一个根的服务器集；同一根重复调用幂等。 */
  ensureRoot(root: string, servers: readonly LspServerDescriptor[]): Promise<void>;
  /** 聚焦一个文件：按扩展名路由 didOpen，等首份诊断快照后返回全部诊断。 */
  focusFile(root: string, relativePath: string): Promise<DiagnosticNote[]>;
  /** 单文件当前快照（无会话/未打开 = 空数组）。 */
  diagnosticsFor(root: string, relativePath: string): DiagnosticNote[];
  /** 释放一个根的全部服务器；无该根时为空操作。 */
  disposeRoot(root: string): Promise<void>;
  /** 释放全部（宿主关机）。 */
  disposeAll(): Promise<void>;
}

export function createLspManager(events: LspManagerEvents = {}, spawnFn?: SpawnFn): LspManager {
  const sessions = new Map<string, Map<string, ClientSession>>();
  const createQueues = new Map<string, Promise<void>>();
  const waiters = new Set<SessionWaiter>();

  const settleWaiters = (uri: string, notes: DiagnosticNote[]): void => {
    for (const waiter of [...waiters]) {
      if (waiter.uri !== uri) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(notes);
    }
  };

  const startSession = async (root: string, descriptor: LspServerDescriptor): Promise<ClientSession> => {
    const diagnostics = new Map<string, DiagnosticNote[]>();
    const client = new LspClient(
      descriptor,
      {
        onNotification: (method, params) => {
          if (method !== "textDocument/publishDiagnostics") return;
          const payload = params as { uri?: unknown; diagnostics?: unknown } | undefined;
          if (typeof payload?.uri !== "string") return;
          const notes = projectDiagnostics(payload.uri, payload.diagnostics);
          diagnostics.set(payload.uri, notes);
          events.onDiagnostics?.(root, notes);
          settleWaiters(payload.uri, notes);
        },
        onExit: (code) => {
          events.log?.("warn", `LSP server ${descriptor.id} exited (code ${code ?? "null"})`);
          sessions.get(root)?.delete(descriptor.id);
        },
        onTransportError: (error) => {
          events.log?.("warn", `LSP server ${descriptor.id} transport error: ${error.message}`);
        },
      },
      spawnFn,
    );
    await client.start({ workspaceRoot: root });
    events.log?.("info", `LSP server ${descriptor.id} started for ${root}`);
    return { client, descriptor, diagnostics, openFiles: new Set() };
  };

  const ensureRootSerialized = async (root: string, servers: readonly LspServerDescriptor[]): Promise<void> => {
    const previous = createQueues.get(root) ?? Promise.resolve();
    const task = previous.then(async () => {
      let byId = sessions.get(root);
      if (byId === undefined) {
        byId = new Map();
        sessions.set(root, byId);
      }
      for (const descriptor of servers) {
        if (byId.has(descriptor.id)) continue;
        try {
          byId.set(descriptor.id, await startSession(root, descriptor));
        } catch (error) {
          events.log?.("warn", `LSP server ${descriptor.id} failed to start: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    createQueues.set(root, tail);
    await task;
    if (createQueues.get(root) === tail) createQueues.delete(root);
  };

  const sessionFor = (root: string, relativePath: string): ClientSession | undefined => {
    const byId = sessions.get(root);
    if (byId === undefined) return undefined;
    const extension = path.extname(relativePath).toLowerCase();
    for (const session of byId.values()) {
      if (session.descriptor.extensions.includes(extension)) return session;
    }
    return undefined;
  };

  return {
    async ensureRoot(root, servers) {
      await ensureRootSerialized(root, servers);
    },
    async focusFile(root, relativePath) {
      const session = sessionFor(root, relativePath);
      if (session === undefined) return [];
      const absolute = path.resolve(root, relativePath);
      const uri = pathToUri(absolute);
      let text: string;
      try {
        const raw = await readFile(absolute);
        if (raw.byteLength > MAX_OPEN_BYTES) return session.diagnostics.get(uri) ?? [];
        text = raw.toString("utf8");
      } catch {
        return session.diagnostics.get(uri) ?? [];
      }
      session.openFiles.add(uri);
      session.client.didOpen(uri, path.extname(relativePath).replace(".", "") || "plaintext", text);
      // 首份快照落定（空数组也算）或收敛上限：按当前已存快照返回。
      return await new Promise<DiagnosticNote[]>((resolve) => {
        const waiter: SessionWaiter = {
          uri,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            resolve(session.diagnostics.get(uri) ?? []);
          }, DIAGNOSTIC_SETTLE_MS),
        };
        waiters.add(waiter);
      });
    },
    diagnosticsFor(root, relativePath) {
      const session = sessionFor(root, relativePath);
      if (session === undefined) return [];
      return session.diagnostics.get(pathToUri(path.resolve(root, relativePath))) ?? [];
    },
    async disposeRoot(root) {
      const task = createQueues.get(root) ?? Promise.resolve();
      await task;
      const byId = sessions.get(root);
      if (byId === undefined) return;
      sessions.delete(root);
      await Promise.allSettled([...byId.values()].map((session) => session.client.dispose()));
    },
    async disposeAll() {
      const roots = [...sessions.keys()];
      await Promise.allSettled(roots.map((root) => this.disposeRoot(root)));
    },
  };
}

/** 供注记渲染：多服务器诊断合并 + 指纹去重（保序）。 */
export function mergeDiagnostics(groups: readonly DiagnosticNote[][]): DiagnosticNote[] {
  const seen = new Set<string>();
  const merged: DiagnosticNote[] = [];
  for (const group of groups) {
    for (const note of group) {
      const fingerprint = diagnosticFingerprint(note);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      merged.push(note);
    }
  }
  return merged;
}

export { uriToPath };
