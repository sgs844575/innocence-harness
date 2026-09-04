import fs from "node:fs";
import path from "node:path";
import { matchGlob } from "@innocenceharness/harness-permissions";
import { resolveWithin, requireString, walkFiles, workspaceScope } from "./paths";
import { engineGrep, engineList, findEngine, type EngineMatch } from "./search-engines";
import type { FsPluginConfig } from "./config";
import type { Tool, ToolContext } from "@innocenceharness/harness-tools";

const FILE_LIMIT = 500;
const MATCH_LIMIT = 200;

type SearchEngineMode = NonNullable<FsPluginConfig["searchEngine"]>;

function listWorkspaceFiles(ctx: ToolContext, subDir?: string): string[] {
  const base = subDir ? resolveWithin(ctx.workspaceRoot, subDir) : ctx.workspaceRoot;
  const files: string[] = [];
  walkFiles(ctx.workspaceRoot, base, files, FILE_LIMIT);
  return files;
}

/**
 * 外部引擎失败时回退纯 Node 扫描；用户中止不是失败，直接上抛交还给
 * 执行器按中止语义收尾。"builtin" 模式（enhancedFindGrep 关闭）从不探测
 * 外部引擎，直接回落内置 Node 扫描。
 */
async function withEngineFallback<T>(
  ctx: ToolContext,
  capability: "grep" | "list",
  mode: SearchEngineMode,
  run: (engine: NonNullable<Awaited<ReturnType<typeof findEngine>>>) => Promise<T>,
): Promise<T | undefined> {
  if (ctx.signal.aborted) return undefined;
  if (mode === "builtin") return undefined;
  const engine = await findEngine(capability);
  if (!engine) return undefined;
  try {
    return await run(engine);
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    ctx.log("warn", "search engine failed; falling back to node scan", err);
    return undefined;
  }
}

/** 命中行形状与纯 Node 路径完全一致：`文件:行号: 内容` + 截断披露。 */
function formatGrepHits(matches: EngineMatch[], total: number, truncated: boolean): string {
  if (total === 0) return "没有匹配行。";
  const shown = matches
    .slice(0, MATCH_LIMIT)
    .map((m) => `${m.file}:${m.line}: ${m.text.trim().slice(0, 200)}`);
  let disclosure = "";
  if (total > MATCH_LIMIT) {
    disclosure = `\n[命中已截断：展示前 ${MATCH_LIMIT} 条 / 共 ${total} 条命中]`;
  } else if (truncated) {
    disclosure = `\n[命中已截断：展示前 ${matches.length} 条 / 结果超出读取上限]`;
  }
  return shown.join("\n") + disclosure;
}

function formatGlobHits(hits: string[]): string {
  if (hits.length === 0) return "没有匹配的文件。";
  return (
    hits.join("\n") + (hits.length >= FILE_LIMIT ? `\n[已达 ${FILE_LIMIT} 条上限]` : "")
  );
}

/** Search resources key on the searched directory ("." for the whole workspace). */
function searchResource(args: Record<string, unknown>, ctx: ToolContext) {
  const scope =
    typeof args.path === "string" && args.path.length > 0
      ? workspaceScope(ctx.workspaceRoot, args.path)
      : ".";
  return { action: "read", kind: "search", scope } as const;
}

/** Find files by glob pattern, e.g. `src` + double-star + `.ts`. */
export function createGlobTool(config: FsPluginConfig = {}): Tool {
  const mode: SearchEngineMode = config.searchEngine === "builtin" ? "builtin" : "auto";
  return {
    name: "Glob",
    description: "按 glob 模式查找工作区文件，如 `src/**/*.ts`。返回相对路径列表。",
    readOnly: true,
    sideEffect: "none",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "glob 模式，支持 ** * ? {a,b}" },
        path: { type: "string", description: "限定搜索的子目录，可选" },
      },
      required: ["pattern"],
    },
    async validateArgs(args) {
      requireString(args, "pattern");
    },
    permissionResource: searchResource,
    async execute(args, ctx: ToolContext) {
      const pattern = requireString(args, "pattern");
      const subDir = typeof args.path === "string" ? args.path : undefined;
      const engineHits = await withEngineFallback(ctx, "list", mode, (engine) =>
        engineList(engine, { root: ctx.workspaceRoot, subDir, signal: ctx.signal }),
      );
      if (engineHits) {
        return {
          content: formatGlobHits(engineHits.filter((f) => matchGlob(pattern, f)).slice(0, FILE_LIMIT)),
        };
      }
      const files = listWorkspaceFiles(ctx, subDir);
      const hits = files.filter((f) => matchGlob(pattern, f));
      return { content: formatGlobHits(hits) };
    },
  };
}

/** Regex search across workspace files, `file:line: text` output. */
export function createGrepTool(config: FsPluginConfig = {}): Tool {
  const mode: SearchEngineMode = config.searchEngine === "builtin" ? "builtin" : "auto";
  return {
    name: "Grep",
    description:
      "在工作区文件中做正则搜索，返回 `文件:行号: 内容`。可用 glob 参数过滤文件名。",
    readOnly: true,
    sideEffect: "none",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "正则表达式" },
        glob: { type: "string", description: "文件名 glob 过滤，如 *.ts，可选" },
        path: { type: "string", description: "限定搜索的子目录，可选" },
      },
      required: ["pattern"],
    },
    async validateArgs(args) {
      requireString(args, "pattern");
    },
    permissionResource: searchResource,
    async execute(args, ctx: ToolContext) {
      const pattern = requireString(args, "pattern");
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, "u");
      } catch (err) {
        throw new Error(`无效正则：${err instanceof Error ? err.message : err}`);
      }
      const globFilter = typeof args.glob === "string" ? args.glob : undefined;
      const subDir = typeof args.path === "string" ? args.path : undefined;
      const engineHits = await withEngineFallback(ctx, "grep", mode, (engine) =>
        engineGrep(engine, {
          root: ctx.workspaceRoot,
          pattern,
          glob: globFilter,
          subDir,
          signal: ctx.signal,
        }),
      );
      if (engineHits) {
        return {
          content: formatGrepHits(engineHits.matches, engineHits.matches.length, engineHits.truncated),
        };
      }

      const files = listWorkspaceFiles(ctx, subDir);
      const matches: EngineMatch[] = [];
      let totalHits = 0;
      for (const rel of files) {
        if (globFilter && !matchGlob(globFilter, path.posix.basename(rel))) continue;
        let content: string;
        try {
          const stat = fs.statSync(path.join(ctx.workspaceRoot, rel));
          if (stat.size > 2_000_000) continue; // skip huge files
          content = fs.readFileSync(path.join(ctx.workspaceRoot, rel), "utf8");
        } catch {
          continue;
        }
        const lines = content.split("\n");
        // 统计完整命中数以披露截断（展示前 N / 共 M），展示列表仍止于上限。
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            totalHits++;
            if (matches.length < MATCH_LIMIT) {
              matches.push({ file: rel, line: i + 1, text: lines[i] });
            }
          }
        }
      }
      return { content: formatGrepHits(matches, totalHits, false) };
    },
  };
}

/** Zero-config search tools（默认 "auto"：探测外部引擎，失败回退 Node 扫描）。 */
export const globTool: Tool = createGlobTool();
export const grepTool: Tool = createGrepTool();
