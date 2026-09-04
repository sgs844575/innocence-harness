// Git 图谱对话框（分支面板「Git 图谱」入口）：全分支拓扑序提交图——左侧 SVG
// 泳道（节点 + 父子连线，泳道色循环用分组七色 token），右侧提交行（主题 +
// 引用徽标 / 作者 / 相对时间 / 短哈希）。Esc/遮罩/X 关闭（同其他对话框范式）。
import { useEffect, useMemo, useState } from "react";
import { GitBranch, LoaderCircle, Tag, X } from "lucide-react";
import type { GitGraphCommit, GitGraphData } from "../../../shared/ipc";
import { api, hasBridge } from "../lib/ipc";
import { relativeTime } from "../lib/time";
import { layoutGitGraph, type GraphEdge } from "./gitGraph";

const LANE_W = 14;
const ROW_H = 32;
/** 泳道色板：分组七色 token 循环（token-first，不写死色值）。 */
const LANE_COLORS = ["blue", "green", "orange", "purple", "red", "yellow", "gray"].map(
  (name) => `var(--color-group-${name})`,
);

function edgePath(edge: GraphEdge, totalRows: number): string {
  const x1 = edge.fromLane * LANE_W + LANE_W / 2;
  const y1 = edge.fromRow * ROW_H + ROW_H / 2;
  const x2 = edge.toLane * LANE_W + LANE_W / 2;
  const y2 = Math.min(edge.toRow, totalRows) * ROW_H + (edge.toRow >= totalRows ? 0 : ROW_H / 2);
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

function refBadge(ref: GitGraphCommit["refs"][number], isHead: boolean): React.JSX.Element {
  return (
    <span
      key={`${ref.kind}:${ref.name}`}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-1.5 font-mono text-xs leading-4 ${
        isHead
          ? "border-(--color-accent) text-(--color-accent)"
          : "border-(--color-border) bg-(--color-raised) text-(--color-muted)"
      }`}
    >
      {ref.kind === "tag" ? <Tag size={10} /> : <GitBranch size={10} />}
      {isHead && <span className="font-bold">HEAD→</span>}
      {ref.name}
    </span>
  );
}

export function GitGraphDialog({
  t,
  root,
  onClose,
}: {
  t: (key: string) => string;
  /** 会话工作区根（打开时已由入口保证非空）。 */
  root: string;
  onClose: () => void;
}): React.JSX.Element {
  // undefined = 加载中；null = 加载失败（非仓库/异常）。
  const [data, setData] = useState<GitGraphData | null | undefined>(undefined);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!hasBridge()) {
      setData(null);
      return;
    }
    let alive = true;
    void api
      .workspaceGitGraph(root)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
  }, [root]);

  const commits = useMemo(() => data?.commits ?? [], [data]);
  const layout = useMemo(() => layoutGitGraph(commits), [commits]);
  const graphWidth = Math.max(1, layout.laneCount) * LANE_W + 4;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" role="dialog" aria-label={t("branch.graph")}>
      <button
        type="button"
        aria-label={t("settings.dialog.cancel")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/25"
      />
      <div
        data-state="open"
        className="modal-in relative flex max-h-[80vh] w-[720px] max-w-[92vw] flex-col rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) shadow-(--shadow-pop)"
      >
        <div className="flex items-center border-b border-(--color-hairline) px-4 py-2.5">
          <span className="font-bold text-(--color-foreground-strong)">{t("branch.graph")}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("settings.dialog.cancel")}
            title={t("settings.dialog.cancel")}
            className="ml-auto grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {data === undefined && (
          <div className="flex items-center justify-center gap-2 py-16 text-(--color-muted)">
            <LoaderCircle size={15} className="animate-spin" />
            {t("graph.loading")}
          </div>
        )}
        {data === null && (
          <div className="py-16 text-center text-(--color-muted)">{t("graph.failed")}</div>
        )}
        {data !== undefined && data !== null && data.commits.length === 0 && (
          <div className="py-16 text-center text-(--color-muted)">{t("graph.empty")}</div>
        )}

        {data !== undefined && data !== null && data.commits.length > 0 && (
          <div className="scrollbar-thin overflow-auto py-1">
            <div className="relative" style={{ height: commits.length * ROW_H }}>
              <svg
                aria-hidden
                className="absolute top-0 left-3"
                width={graphWidth}
                height={commits.length * ROW_H}
              >
                {layout.edges.map((edge, index) => (
                  <path
                    key={index}
                    d={edgePath(edge, commits.length)}
                    fill="none"
                    stroke={LANE_COLORS[edge.fromLane % LANE_COLORS.length]}
                    strokeWidth={1.5}
                  />
                ))}
                {commits.map((commit, row) => {
                  const lane = layout.nodeLanes[row] ?? 0;
                  const isHead = commit.refs.some((ref) => ref.kind === "branch" && ref.name === data.head);
                  const color = LANE_COLORS[lane % LANE_COLORS.length];
                  return (
                    <circle
                      key={commit.hash}
                      cx={lane * LANE_W + LANE_W / 2}
                      cy={row * ROW_H + ROW_H / 2}
                      r={isHead ? 4 : 3}
                      fill={isHead ? "var(--color-accent)" : "var(--color-popup)"}
                      stroke={isHead ? "var(--color-accent)" : color}
                      strokeWidth={1.5}
                    />
                  );
                })}
              </svg>
              <div style={{ paddingLeft: graphWidth + 16 }}>
                {commits.map((commit) => (
                  <div
                    key={commit.hash}
                    className="flex items-center gap-2 overflow-hidden rounded-md pr-3 whitespace-nowrap hover:bg-(--color-hover)"
                    style={{ height: ROW_H }}
                  >
                    <span className="min-w-0 shrink truncate text-(--color-foreground)">{commit.subject}</span>
                    {commit.refs.map((ref) => refBadge(ref, ref.kind === "branch" && ref.name === data.head))}
                    <span className="ml-auto w-28 shrink-0 truncate text-right text-(--color-muted)">{commit.author}</span>
                    <span className="w-14 shrink-0 text-right text-(--color-faint)">{relativeTime(commit.at * 1000)}</span>
                    <span className="w-16 shrink-0 font-mono text-(--color-faint)">{commit.hash.slice(0, 7)}</span>
                  </div>
                ))}
              </div>
            </div>
            {data.truncated && (
              <div className="border-t border-(--color-hairline) px-4 py-2 text-(--color-faint)">
                {t("graph.truncated").replace("{n}", String(data.commits.length))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
