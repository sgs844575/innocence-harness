// 审查标签页：workspace Git 改动审查。头部 = 作用域下拉（未暂存/已暂存）+
// 刷新钮；主体 = 改动文件行列表（类型图标 + 目录 + ±行数 + chevron 展开行内
// diff：双列行号 + diff-line-add/del 行块）。数据源经 props 注入（App 绑 api）。
import { useCallback, useEffect, useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { ReviewFileDiffResult, ReviewFileEntry, ReviewScope } from "../../../shared/ipc";
import { parseUnifiedPatch, type ReviewDiffHunk } from "./reviewDiff";

interface Props {
  t: (key: string) => string;
  /** 审查目标项目根；空串 = 未在项目中（按非仓库空态展示）。 */
  workspaceRoot: string;
  /** 值变化即重载（App 传 gitTick+流式状态：分支切换/一轮结束等时机）。 */
  reloadSignal?: unknown;
  loadFiles: (root: string, scope: ReviewScope) => Promise<{ files: ReviewFileEntry[] } | null>;
  loadDiff: (root: string, scope: ReviewScope, path: string) => Promise<ReviewFileDiffResult>;
}

/** 展开中的单文件 diff 视图状态。 */
interface FileDiffState {
  loading: boolean;
  hunks?: ReviewDiffHunk[];
  /** 未跟踪新文件：全文按全新增渲染。 */
  untrackedText?: string;
}

/** 文件类型图标（lucide 线图标，按扩展名小集合）。 */
function reviewFileIcon(relPath: string): typeof File {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "css", "html", "vue", "svelte", "py", "rs", "go", "java", "c", "cpp", "h"].includes(ext))
    return FileCode;
  if (["json", "jsonc", "json5"].includes(ext)) return FileJson;
  if (["png", "jpg", "jpeg", "gif", "svg", "ico", "icns", "webp"].includes(ext)) return ImageIcon;
  if (["md", "markdown", "txt", "log"].includes(ext)) return FileText;
  return File;
}

/** diff 行块：双列行号（旧/新）+ diff-line 色条行；不换行，横向滚动。 */
function DiffRows({ hunks }: { hunks: ReviewDiffHunk[] }): React.JSX.Element {
  return (
    <div className="scrollbar-thin w-full min-w-0 max-w-full overflow-auto rounded-xl bg-(--color-background) font-mono code-text leading-relaxed">
      {hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex}>
          {hunkIndex > 0 && (
            <div className="border-y border-(--color-hairline) px-2 py-0.5 text-(--color-faint) select-none">
              {hunk.header}
            </div>
          )}
          {hunk.rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className={`flex w-fit min-w-full ${
                row.type === "add" ? "diff-line-add" : row.type === "del" ? "diff-line-del" : ""
              }`}
            >
              <span className="w-9 shrink-0 pr-2 text-right text-(--color-faint) select-none">{row.oldNo ?? ""}</span>
              <span className="w-9 shrink-0 pr-2 text-right text-(--color-faint) select-none">{row.newNo ?? ""}</span>
              <span className="pr-3 whitespace-pre text-(--color-foreground)">{row.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ReviewView({ t, workspaceRoot, reloadSignal = 0, loadFiles, loadDiff }: Props): React.JSX.Element {
  const [scope, setScope] = useState<ReviewScope>("unstaged");
  /** undefined = 加载中；null = 非仓库/无项目根；数组 = 文件列表（可空）。 */
  const [result, setResult] = useState<{ files: ReviewFileEntry[] } | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, FileDiffState>>({});

  const refresh = useCallback(async () => {
    if (workspaceRoot.trim() === "") {
      setResult(null);
      return;
    }
    setRefreshing(true);
    try {
      setResult(await loadFiles(workspaceRoot, scope).catch(() => null));
      setExpanded({}); // 刷新后丢弃展开缓存（内容可能已变）
    } finally {
      setRefreshing(false);
    }
  }, [workspaceRoot, scope, loadFiles]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadSignal]);

  const toggleFile = (relPath: string): void => {
    if (expanded[relPath]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[relPath];
        return next;
      });
      return;
    }
    setExpanded((prev) => ({ ...prev, [relPath]: { loading: true } }));
    void loadDiff(workspaceRoot, scope, relPath).then((diff) => {
      setExpanded((prev) => {
        if (!(relPath in prev)) return prev; // 加载途中被收起：丢弃
        const state: FileDiffState = { loading: false };
        if (diff?.kind === "patch") state.hunks = parseUnifiedPatch(diff.patch);
        if (diff?.kind === "untracked") state.untrackedText = diff.text;
        return { ...prev, [relPath]: state };
      });
    });
  };

  return (
    <div data-testid="review-view" className="flex min-h-0 flex-1 flex-col">
      {/* 头部：作用域下拉 + 刷新。 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-(--color-hairline) px-3">
        <RadixPopover.Root open={scopeOpen} onOpenChange={setScopeOpen}>
          <RadixPopover.Trigger asChild>
            <button
              type="button"
              aria-expanded={scopeOpen}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-(--color-raised) px-2.5 text-[13px] text-(--color-foreground) hover:bg-(--color-hover)"
            >
              {t(scope === "unstaged" ? "dock.review.scope.unstaged" : "dock.review.scope.staged")}
              <ChevronDown size={13} strokeWidth={1.5} className="text-(--color-faint)" aria-hidden />
            </button>
          </RadixPopover.Trigger>
          <RadixPopover.Portal>
            <RadixPopover.Content
              align="start"
              side="bottom"
              sideOffset={6}
              className="dropdown-in z-50 w-[160px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1.5 shadow-(--shadow-pop)"
            >
              {(["unstaged", "staged"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => {
                    setScope(candidate);
                    setScopeOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-(--color-foreground) hover:bg-(--color-hover)"
                >
                  <span className="flex-1">{t(`dock.review.scope.${candidate}`)}</span>
                  {candidate === scope && <Check size={13} strokeWidth={1.5} className="text-(--color-accent)" aria-hidden />}
                </button>
              ))}
            </RadixPopover.Content>
          </RadixPopover.Portal>
        </RadixPopover.Root>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          aria-label={t("dock.review.refresh")}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground) disabled:opacity-50"
        >
          {refreshing ? (
            <LoaderCircle size={13} strokeWidth={1.5} className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw size={13} strokeWidth={1.5} aria-hidden />
          )}
          {t("dock.review.refresh")}
        </button>
      </div>
      {/* 主体：空态 / 文件列表。 */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {result === undefined ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle size={18} strokeWidth={1.5} className="animate-spin text-(--color-faint)" aria-hidden />
          </div>
        ) : result === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText size={22} strokeWidth={1.3} className="text-(--color-faint)" aria-hidden />
            <span className="text-[13px] font-medium text-(--color-foreground)">{t("dock.review.notRepo")}</span>
            <span className="text-[12px] text-(--color-faint)">{t("dock.review.notRepoHint")}</span>
          </div>
        ) : result.files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-(--color-faint)">
            <Check size={22} strokeWidth={1.3} aria-hidden />
            <span className="text-[13px]">{t("dock.review.empty")}</span>
          </div>
        ) : (
          <ul className="py-1">
            {result.files.map((file) => {
              const state = expanded[file.path];
              const isOpen = state !== undefined;
              const Icon = reviewFileIcon(file.path);
              const slash = file.path.replace(/\\/g, "/");
              const dir = slash.includes("/") ? slash.slice(0, slash.lastIndexOf("/") + 1) : "";
              const name = slash.slice(dir.length);
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => toggleFile(file.path)}
                    aria-expanded={isOpen}
                    className="group/review-row flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-(--color-hover)"
                  >
                    <Icon size={15} strokeWidth={1.4} className="shrink-0 text-(--color-muted)" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <span className="text-(--color-foreground)">{name}</span>
                      {dir !== "" && <span className="text-(--color-faint)"> {dir}</span>}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 font-mono leading-none whitespace-nowrap tabular-nums">
                      {(file.additions > 0 || file.untracked === true) && (
                        <span className="text-(--color-diff-add)">+{file.additions}</span>
                      )}
                      {file.deletions > 0 && <span className="text-(--color-diff-del)">−{file.deletions}</span>}
                    </span>
                    <ChevronRight
                      size={13}
                      strokeWidth={1.5}
                      aria-hidden
                      className={`shrink-0 text-(--color-faint) transition-transform duration-(--duration-fast) ease-(--ease-smooth-out) motion-reduce:transition-none ${
                        isOpen ? "rotate-90" : ""
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-3 pt-1 pb-2">
                      {state.loading ? (
                        <div className="flex h-16 items-center justify-center">
                          <LoaderCircle size={15} strokeWidth={1.5} className="animate-spin text-(--color-faint)" aria-hidden />
                        </div>
                      ) : state.untrackedText !== undefined ? (
                        <div className="scrollbar-thin w-full min-w-0 max-w-full overflow-auto rounded-xl bg-(--color-background) font-mono code-text leading-relaxed">
                          {(state.untrackedText.endsWith("\n") ? state.untrackedText.slice(0, -1) : state.untrackedText)
                            .split("\n")
                            .map((line, lineIndex) => (
                              <div key={lineIndex} className="diff-line-add flex w-fit min-w-full">
                                <span className="w-9 shrink-0 pr-2 text-right text-(--color-faint) select-none" />
                                <span className="w-9 shrink-0 pr-2 text-right text-(--color-faint) select-none">{lineIndex + 1}</span>
                                <span className="pr-3 whitespace-pre text-(--color-foreground)">{line}</span>
                              </div>
                            ))}
                        </div>
                      ) : state.hunks && state.hunks.length > 0 ? (
                        <DiffRows hunks={state.hunks} />
                      ) : (
                        <div className="py-1 text-[12px] text-(--color-faint)">{t("dock.review.noDiff")}</div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
