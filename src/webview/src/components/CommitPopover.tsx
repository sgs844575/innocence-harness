// 提交对话框（Git 胶囊「提交或推送」行触发，居中模态展示）：头部 = 交互式分支胶囊
// （复用标题栏/分支行同一 BranchPickerPopover 面板）+ 增删统计；提交信息输入
// （留空自动生成，右上 Sparkles 走 workspaceGitCommitMessage，Ctrl/Cmd+Enter = 提交）；
// 「包含未暂存的更改」勾选；三行动作 = 提交 / 提交并推送 / 推送。
// 提交成功清空输入并回调 onCommitted（宿主重拉 Git 数据）；提交并推送里推送失败
// 只提示推送错误——提交已落盘，仍按成功收尾。
import { useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import {
  ChevronDown,
  CloudUpload,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { api } from "../lib/ipc";
import { BranchPickerPopover } from "./BranchPicker";

export interface CommitPopoverProps {
  t: (key: string) => string;
  /** 会话工作区根（提交/推送/生成与分支面板的共同目标）。 */
  root: string;
  /** 当前分支（null = 空仓/未检测：分支胶囊显示「未检测」占位）。 */
  branch: string | null;
  /** 工作区 diff 统计（stagedFiles/unstagedFiles 未知时按 changedFiles 判定可提交）。 */
  changes?: { changedFiles: number; additions: number; deletions: number; stagedFiles?: number; unstagedFiles?: number };
  /** 分支检出成功回调（驱动 Git 数据重拉）。 */
  onSwitched: (branch: string) => void;
  /** 提交/推送成功回调（驱动 Git 数据重拉）。 */
  onCommitted: () => void;
  onError: (message: string) => void;
  /** 分支面板「Git 图谱」入口（透传）。 */
  onOpenGraph?: () => void;
  /** 触发器元素（必须是可挂 ref 的单元素，如 button）。 */
  trigger: React.ReactNode;
}

type BusyKind = "commit" | "commit-push" | "push" | "generate";

const actionRow =
  "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45";

export function CommitPopover({
  t,
  root,
  branch,
  changes,
  onSwitched,
  onCommitted,
  onError,
  onOpenGraph,
  trigger,
}: CommitPopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [busy, setBusy] = useState<BusyKind | null>(null);

  const staged = changes?.stagedFiles;
  const unstaged = changes?.unstagedFiles;
  // 暂存/未暂存拆分未知（旧桥）时退化按总更改数判定可提交。
  const canCommit =
    staged !== undefined && unstaged !== undefined
      ? staged > 0 || (includeUnstaged && unstaged > 0)
      : changes !== undefined
        ? changes.changedFiles > 0
        : false;
  const busyText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  /** 推送一步：失败只提示，不改输入态（提交并推送里提交已落盘）。 */
  const doPush = async (): Promise<boolean> => {
    try {
      const result = await api.workspaceGitPush(root);
      if (!result.ok) {
        onError(t("commit.pushFailed") + (result.error ? `：${result.error}` : ""));
        return false;
      }
      return true;
    } catch (error) {
      onError(`${t("commit.pushFailed")}：${busyText(error)}`);
      return false;
    }
  };

  /** 提交一步：失败提示并保留输入。 */
  const doCommit = async (): Promise<boolean> => {
    try {
      const result = await api.workspaceGitCommit(root, message, includeUnstaged);
      if (!result.ok) {
        onError(t("commit.failed") + (result.error ? `：${result.error}` : ""));
        return false;
      }
      return true;
    } catch (error) {
      onError(`${t("commit.failed")}：${busyText(error)}`);
      return false;
    }
  };

  const run = (kind: "commit" | "commit-push" | "push"): void => {
    if (busy !== null) return;
    setBusy(kind);
    void (async () => {
      try {
        if (kind === "push") {
          if (await doPush()) {
            onCommitted();
            setOpen(false);
          }
          return;
        }
        if (!(await doCommit())) return;
        // 提交并推送：推送失败不回滚已落盘的提交，仍按成功收尾。
        if (kind === "commit-push") await doPush();
        setMessage("");
        onCommitted();
        setOpen(false);
      } finally {
        setBusy(null);
      }
    })();
  };

  const generate = (): void => {
    if (busy !== null) return;
    setBusy("generate");
    void api
      .workspaceGitCommitMessage(root)
      .then((result) => {
        if (result.ok && result.message) {
          setMessage(result.message);
        } else {
          onError(t("commit.generateFailed") + (result.error ? `：${result.error}` : ""));
        }
      })
      .catch((error) => onError(`${t("commit.generateFailed")}：${busyText(error)}`))
      .finally(() => setBusy(null));
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          data-testid="commit-dialog-overlay"
          className="fixed inset-0 z-50 bg-(--color-background)/80 backdrop-blur-sm"
        />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="modal-in fixed top-1/2 left-1/2 z-50 w-[448px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-3 shadow-(--shadow-pop) outline-none"
        >
          <RadixDialog.Title className="sr-only">{t("capsule.commitPush")}</RadixDialog.Title>
          {/* 头部：分支胶囊（嵌套分支面板）+ 增删统计。 */}
          <div className="flex items-center gap-2">
            <BranchPickerPopover
              t={t}
              root={root}
              current={branch}
              onSwitched={onSwitched}
              onError={onError}
              onOpenGraph={onOpenGraph}
              trigger={
                <button
                  type="button"
                  title={branch ?? t("capsule.branch.unknown")}
                  className="flex h-7 min-w-0 items-center gap-2 rounded-full bg-(--color-raised) px-3 whitespace-nowrap text-(--color-foreground) outline-none hover:bg-(--color-hover)"
                >
                  <GitBranch size={13} strokeWidth={1.3} className="shrink-0 text-(--color-muted)" />
                  <span className="max-w-[140px] truncate font-mono">{branch ?? t("capsule.branch.unknown")}</span>
                  <ChevronDown size={12} className="shrink-0 text-(--color-faint)" />
                </button>
              }
            />
            {changes && (
              <span className="ml-auto shrink-0 font-mono leading-none tabular-nums">
                <span className="text-(--color-diff-add)">+{changes.additions}</span>{" "}
                <span className="text-(--color-diff-del)">−{changes.deletions}</span>
              </span>
            )}
          </div>

          {/* 提交信息输入：留空自动生成；Ctrl/Cmd+Enter = 提交。 */}
          <div className="relative mt-3">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  if (canCommit) run("commit");
                }
              }}
              placeholder={t("commit.messagePlaceholder")}
              aria-label={t("commit.messagePlaceholder")}
              rows={6}
              className="min-h-32 w-full resize-none rounded-lg bg-(--color-surface) px-2.5 py-2 outline-none placeholder:text-(--color-faint)"
            />
            <button
              type="button"
              onClick={generate}
              disabled={busy !== null}
              aria-label={t("commit.generate")}
              title={t("commit.generate")}
              className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground) disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy === "generate" ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} strokeWidth={1.3} />
              )}
            </button>
          </div>

          {/* 未暂存勾选：默认带上；无未暂存更改时禁用。 */}
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-(--color-muted)">
            <input
              type="checkbox"
              checked={includeUnstaged}
              disabled={unstaged === 0}
              onChange={(event) => setIncludeUnstaged(event.target.checked)}
              aria-label={t("commit.includeUnstaged")}
            />
            <span>{t("commit.includeUnstaged")}</span>
            {unstaged !== undefined && (
              <span className="ml-auto text-(--color-faint)">
                {t("commit.files").replace("{n}", String(unstaged))}
              </span>
            )}
          </label>

          <div className="my-3 h-px bg-(--color-hairline)" />

          <div className="flex flex-col gap-1">
            <button
              type="button"
              disabled={!canCommit || busy !== null}
              aria-description={!canCommit && busy === null ? t("commit.nothing") : undefined}
              onClick={() => run("commit")}
              className={`${actionRow} bg-(--color-raised) text-(--color-foreground) hover:bg-(--color-hover)`}
            >
              {busy === "commit" ? (
                <LoaderCircle size={13} className="shrink-0 animate-spin" />
              ) : (
                <GitCommitHorizontal size={13} strokeWidth={1.3} className="shrink-0 text-(--color-muted)" />
              )}
              {t("commit.commit")}
              <span className="ml-auto text-(--color-faint)">Ctrl+↵</span>
            </button>
            <button
              type="button"
              disabled={!canCommit || busy !== null}
              aria-description={!canCommit && busy === null ? t("commit.nothing") : undefined}
              onClick={() => run("commit-push")}
              className={`${actionRow} text-(--color-foreground) hover:bg-(--color-hover)`}
            >
              {busy === "commit-push" ? (
                <LoaderCircle size={13} className="shrink-0 animate-spin" />
              ) : (
                <CloudUpload size={13} strokeWidth={1.3} className="shrink-0 text-(--color-muted)" />
              )}
              {t("commit.commitPush")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run("push")}
              className={`${actionRow} text-(--color-foreground) hover:bg-(--color-hover)`}
            >
              {busy === "push" ? (
                <LoaderCircle size={13} className="shrink-0 animate-spin" />
              ) : (
                <CloudUpload size={13} strokeWidth={1.3} className="shrink-0 text-(--color-muted)" />
              )}
              {t("commit.push")}
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
