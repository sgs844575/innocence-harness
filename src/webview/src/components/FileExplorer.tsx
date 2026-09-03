// 侧栏内项目文件树（参考形态）：返回任务 + 搜索（全量路径子串过滤）+ 懒加载
// 目录树 + Git 变更圆点标记；文件点击经 onOpenFile 交给外层（dock 文件标签）。
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, Folder, Search, X } from "lucide-react";
import type { WorkspaceDirEntry } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";

interface Props {
  t: (key: string) => string;
  /** 项目根（真实路径，空串不进入本视图）。 */
  root: string;
  onBack: () => void;
  onOpenFile: (relPath: string) => void;
}

/** Git 变更标记集：文件命中 + 各级父目录命中（参考的目录圆点）。 */
function changedPrefixSet(files: readonly string[]): ReadonlySet<string> {
  const marks = new Set<string>();
  for (const file of files) {
    marks.add(file);
    const segments = file.split("/");
    for (let i = 1; i < segments.length; i += 1) marks.add(segments.slice(0, i).join("/"));
  }
  return marks;
}

export function FileExplorer({ t, root, onBack, onOpenFile }: Props): React.JSX.Element {
  /** 已加载的目录条目（key = 目录相对路径，"" = 根；缺 key = 未加载/加载中）。 */
  const [dirs, setDirs] = useState<ReadonlyMap<string, readonly WorkspaceDirEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [allFiles, setAllFiles] = useState<readonly string[] | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;

  // 进入项目：装载根目录 + Git 变更集（两作用域合并；非仓库/失败 → 空）。
  useEffect(() => {
    if (!hasBridge()) return;
    let cancelled = false;
    void api
      .listWorkspaceDir(root, "")
      .then((entries) => {
        if (!cancelled) setDirs((current) => new Map(current).set("", entries));
      })
      .catch(() => undefined);
    void Promise.all([
      api.workspaceGitReviewFiles(root, "unstaged"),
      api.workspaceGitReviewFiles(root, "staged"),
    ])
      .then(([unstaged, staged]) => {
        if (cancelled) return;
        const files = [...(unstaged?.files ?? []), ...(staged?.files ?? [])].map((file) => file.path);
        setChanged(changedPrefixSet(files));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [root]);

  const loadDir = (rel: string): void => {
    if (dirsRef.current.has(rel) || !hasBridge()) return;
    void api
      .listWorkspaceDir(root, rel)
      .then((entries) => setDirs((current) => new Map(current).set(rel, entries)))
      .catch(() => undefined);
  };

  const toggleDir = (rel: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    if (!expanded.has(rel)) loadDir(rel);
  };

  // 搜索：首个非空查询时装载全量清单一次，之后本地子串过滤（大小写不敏感）。
  const searching = query.trim() !== "";
  useEffect(() => {
    if (!searching || allFiles !== null || !hasBridge()) return;
    let cancelled = false;
    void api
      .listWorkspaceFiles(root)
      .then((files) => {
        if (!cancelled) setAllFiles(files);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [searching, allFiles, root]);

  const matches = useMemo(() => {
    if (!searching) return null;
    const needle = query.trim().toLowerCase();
    return (allFiles ?? []).filter((file) => file.toLowerCase().includes(needle)).slice(0, 200);
  }, [searching, allFiles, query]);

  const dot = (rel: string) =>
    changed.has(rel) ? <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-(--color-tool-warn)" /> : null;

  const renderEntries = (relDir: string, depth: number): React.ReactNode =>
    (dirs.get(relDir) ?? []).map((entry) => (
      <li key={entry.rel}>
        <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
          {entry.isDir ? (
            <button
              type="button"
              onClick={() => toggleDir(entry.rel)}
              aria-expanded={expanded.has(entry.rel)}
              className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
            >
              <ChevronRight size={12} className={`shrink-0 text-(--color-faint) ${expanded.has(entry.rel) ? "rotate-90" : ""}`} />
              <Folder size={13} className="shrink-0 text-(--color-faint)" aria-hidden />
              <span className="min-w-0 truncate">{entry.name}</span>
              {dot(entry.rel)}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenFile(entry.rel)}
              title={entry.rel}
              className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
            >
              <span className="w-3 shrink-0" />
              <FileText size={13} className="shrink-0 text-(--color-faint)" aria-hidden />
              <span className="min-w-0 truncate">{entry.name}</span>
              {dot(entry.rel)}
            </button>
          )}
        </div>
        {entry.isDir && expanded.has(entry.rel) && (
          <ul>{dirs.has(entry.rel) ? renderEntries(entry.rel, depth + 1) : (
            <li className="px-2 py-1 text-(--color-faint)" style={{ paddingLeft: (depth + 1) * 12 + 8 }}>
              {t("sidebar.files.loading")}
            </li>
          )}</ul>
        )}
      </li>
    ));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶行：返回任务 + 项目名。 */}
      <div className="flex items-center gap-1 px-2.5 pt-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("sidebar.files.back")}
          title={t("sidebar.files.back")}
          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
        >
          <ArrowLeft size={13} />
          {t("sidebar.files.back")}
        </button>
      </div>
      {/* 搜索框：非空时切换为全量过滤列表。 */}
      <div className="px-2.5 pt-2">
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-(--color-border) bg-(--color-surface) px-2.5">
          <Search size={13} className="shrink-0 text-(--color-faint)" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("sidebar.files.search")}
            aria-label={t("sidebar.files.search")}
            className="w-full bg-transparent outline-none placeholder:text-(--color-faint)"
          />
          {searching && (
            <button
              type="button"
              aria-label={t("chat.edit.cancel")}
              onClick={() => setQuery("")}
              className="shrink-0 text-(--color-muted) hover:text-(--color-foreground)"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1.5 pt-1.5">
        {searching ? (
          <ul className="space-y-px">
            {(matches ?? []).map((file) => (
              <li key={file}>
                <button
                  type="button"
                  onClick={() => onOpenFile(file)}
                  title={file}
                  className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-(--color-foreground) hover:bg-(--color-hover)"
                >
                  <FileText size={13} className="shrink-0 text-(--color-faint)" aria-hidden />
                  <span className="min-w-0 truncate font-mono text-[13px]">{file}</span>
                  {dot(file)}
                </button>
              </li>
            ))}
            {matches !== null && matches.length === 0 && (
              <li className="px-2 py-3 text-center text-(--color-muted)">{t("sidebar.files.empty")}</li>
            )}
            {matches === null && (
              <li className="px-2 py-3 text-center text-(--color-muted)">{t("sidebar.files.loading")}</li>
            )}
          </ul>
        ) : (
          <ul className="space-y-px">{renderEntries("", 0)}</ul>
        )}
      </div>
    </div>
  );
}
