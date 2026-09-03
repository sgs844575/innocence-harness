import { spawn } from "node:child_process";

/**
 * 外部搜索引擎链：Grep/Glob 在探测到可用的外部搜索二进制时优先走外部引擎
 * （更大工作区下远快于逐文件读取），探测失败或执行失败由 search.ts 回退到
 * 纯 Node 扫描。引擎按数组顺序探测，进程级缓存探测结果。
 *
 * 约定：引擎只负责取数与解析，不感知工作区边界（上游已用 resolveWithin
 * 校验 subDir）；输出路径统一归一为工作区相对 POSIX 风格，与纯 Node 路径
 * 的产物形状一致。
 */

export interface EngineGrepRequest {
  /** 绝对工作区根，作为子进程 cwd（输出路径因此天然工作区相对）。 */
  root: string;
  /** 正则源串。 */
  pattern: string;
  /** 文件名 glob 过滤，可选。 */
  glob?: string;
  /** 限定搜索的工作区相对子目录，可选。 */
  subDir?: string;
  signal?: AbortSignal;
}

export interface EngineListRequest {
  root: string;
  subDir?: string;
  signal?: AbortSignal;
}

export interface EngineMatch {
  file: string;
  line: number;
  text: string;
}

export interface EngineGrepResult {
  matches: EngineMatch[];
  /** 输出超限/超时被截断：matches 不完整，不得宣称是全部命中。 */
  truncated: boolean;
}

/** 受控外部进程调用端口；测试注入假实现。 */
export interface ProcessOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** 输出超限或超时被提前终止：stdout 不完整。 */
  incomplete: boolean;
}

export type ProcessRunner = (
  binary: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal },
) => Promise<ProcessOutput>;

export interface SearchEngine {
  /** 探测身份（即可执行文件名）。 */
  readonly id: string;
  readonly supportsFileListing: boolean;
  versionArgs(): string[];
  grepArgs(req: EngineGrepRequest): string[];
  listArgs(req: EngineListRequest): string[];
  /** 解析一行 stdout 为命中；噪声行返回 null。 */
  parseMatchLine(line: string): EngineMatch | null;
}

/** 统一路径形状：工作区相对 + 正斜杠。 */
function normalizePath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "");
}

function engineFromJsonLine(line: string): EngineMatch | null {
  if (!line.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const obj = parsed as {
    type?: string;
    data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
  };
  if (obj.type !== "match") return null;
  const file = obj.data?.path?.text;
  const lineNo = obj.data?.line_number;
  if (typeof file !== "string" || typeof lineNo !== "number") return null;
  return {
    file: normalizePath(file),
    line: lineNo,
    text: (obj.data?.lines?.text ?? "").replace(/\r?\n$/, ""),
  };
}

/** grep 家族经典输出 `path:line:text`；贪婪匹配兼容 Windows 盘符冒号路径。 */
function engineFromClassicLine(line: string): EngineMatch | null {
  const m = /^(.*):(\d+):(.*)$/.exec(line);
  if (!m) return null;
  return { file: normalizePath(m[1]), line: Number(m[2]), text: m[3] };
}

const ENGINES: SearchEngine[] = [
  {
    id: "rg",
    supportsFileListing: true,
    versionArgs: () => ["--version"],
    grepArgs: (req) => [
      "--json",
      "--no-heading",
      "--max-filesize",
      "2M",
      "--path-separator",
      "/",
      ...(req.glob ? ["--glob", req.glob] : []),
      "--",
      req.pattern,
      req.subDir ?? ".",
    ],
    listArgs: (req) => ["--files", "--path-separator", "/", ...(req.subDir ? [req.subDir] : [])],
    parseMatchLine: engineFromJsonLine,
  },
  {
    id: "ugrep",
    supportsFileListing: false,
    versionArgs: () => ["--version"],
    grepArgs: (req) => [
      "-r",
      "-n",
      "-I",
      "--ignore-files",
      ...(req.glob ? ["-g", req.glob] : []),
      "--",
      req.pattern,
      req.subDir ?? ".",
    ],
    listArgs: () => {
      throw new Error("engine does not support file listing");
    },
    parseMatchLine: engineFromClassicLine,
  },
];

/** 默认实现：无 shell 直 spawn（参数数组，模式串永不进 shell），UTF-8 解码。 */
export const spawnSearchProcess: ProcessRunner = (binary, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: opts.cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const decoder = new TextDecoder("utf-8");
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let incomplete = false;
    let settled = false;

    const finish = (exitCode: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ exitCode, stdout, stderr, incomplete });
    };
    const kill = () => {
      incomplete = true;
      child.kill();
    };
    const timer = setTimeout(() => {
      kill();
      // 留一个微任务让 close 事件先到；kill 后 close 总会触发。
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > opts.maxOutputBytes) {
        kill();
        return;
      }
      stdout += decoder.decode(chunk, { stream: true });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_192) stderr += decoder.decode(chunk, { stream: true });
    });
    child.on("error", (err) => finish(null, err));
    child.on("close", (code) => {
      stdout += decoder.decode();
      finish(code);
    });
    if (opts.signal) {
      if (opts.signal.aborted) kill();
      else opts.signal.addEventListener("abort", kill, { once: true });
    }
  });

// 测试注入点：让 search.ts 的单例工具在测试里使用假 runner。
let runnerImpl: ProcessRunner = spawnSearchProcess;
export function setProcessRunnerForTests(runner: ProcessRunner | undefined): void {
  runnerImpl = runner ?? spawnSearchProcess;
}

const PROBE_TIMEOUT_MS = 3_000;
const RUN_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

const probeCache = new Map<string, Promise<boolean>>();

/** 清空探测缓存（测试隔离用）。 */
export function resetEngineProbes(): void {
  probeCache.clear();
}

function engineAvailable(engine: SearchEngine): Promise<boolean> {
  let cached = probeCache.get(engine.id);
  if (!cached) {
    cached = runnerImpl(engine.id, engine.versionArgs(), {
      cwd: process.cwd(),
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: MAX_STDERR_BYTES,
    })
      .then((r) => r.exitCode === 0)
      .catch(() => false);
    probeCache.set(engine.id, cached);
  }
  return cached;
}

/**
 * 找到第一个支持目标能力且可用的引擎；全部不可用返回 undefined，
 * 调用方走纯 Node 路径。
 */
export async function findEngine(
  capability: "grep" | "list",
): Promise<SearchEngine | undefined> {
  for (const engine of ENGINES) {
    if (capability === "list" && !engine.supportsFileListing) continue;
    if (await engineAvailable(engine)) return engine;
  }
  return undefined;
}

/**
 * 外部引擎取命中。退出码 0=有命中、1=无命中；2=引擎级错误——已有部分
 * 命中则带截断标记返回，否则抛错由调用方回退纯 Node 扫描。
 */
export async function engineGrep(
  engine: SearchEngine,
  req: EngineGrepRequest,
): Promise<EngineGrepResult> {
  const run = await runnerImpl(engine.id, engine.grepArgs(req), {
    cwd: req.root,
    timeoutMs: RUN_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    signal: req.signal,
  });
  const matches: EngineMatch[] = [];
  for (const line of run.stdout.split("\n")) {
    const match = engine.parseMatchLine(line.trimEnd());
    if (match) matches.push(match);
  }
  if (run.exitCode === 2 && matches.length === 0) {
    throw new Error(`搜索引擎执行失败：${run.stderr.trim().slice(-400) || `exit ${run.exitCode}`}`);
  }
  return { matches, truncated: run.incomplete || run.exitCode === 2 };
}

/** 外部引擎列候选文件（相对路径）；引擎级错误抛出由调用方回退。 */
export async function engineList(
  engine: SearchEngine,
  req: EngineListRequest,
): Promise<string[]> {
  const run = await runnerImpl(engine.id, engine.listArgs(req), {
    cwd: req.root,
    timeoutMs: RUN_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    signal: req.signal,
  });
  if (run.exitCode === 2) {
    throw new Error(`搜索引擎执行失败：${run.stderr.trim().slice(-400) || `exit ${run.exitCode}`}`);
  }
  return run.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(normalizePath);
}
