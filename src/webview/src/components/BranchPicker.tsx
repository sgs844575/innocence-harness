// 分支面板（对齐参考）：触发器 → 搜索 + 本地分支列表（当前分支置顶、带未提交
// 更改统计）+ 创建并检出新分支 + Git 图谱（打开图谱对话框）。检出走
// workspaceGitCheckout。BranchPicker = 标题栏胶囊触发器；BranchPickerPopover
// 是共享主体，任意触发器（如 Git 胶囊分支行）可复用同一面板。
import { useEffect, useRef, useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Check, ChevronDown, GitBranch, Network, Plus, Search } from "lucide-react";
import { api, hasBridge } from "../lib/ipc";

export interface BranchPickerBaseProps {
  t: (key: string) => string;
  /** 会话工作区根；空 = 无项目上下文（退化为不可点的静态触发器）。 */
  root: string;
  /** 当前分支（null = 未检测/空仓：列表无勾选项，面板仍可打开）。 */
  current: string | null;
  onSwitched: (branch: string) => void;
  onError: (message: string) => void;
  /** 「Git 图谱」入口（缺省 = 禁用占位）。 */
  onOpenGraph?: () => void;
}

interface PopoverProps extends BranchPickerBaseProps {
  /** 触发器元素（必须是可挂 ref 的单元素，如 button）。 */
  trigger: React.ReactNode;
  /** 浮层相对触发器的方向；标题栏默认向下，侧边浮动卡可指定向左。 */
  side?: RadixPopover.PopoverContentProps["side"];
  /** 浮层在所选方向上的对齐方式。 */
  align?: RadixPopover.PopoverContentProps["align"];
}

const pill =
  "app-no-drag ml-3 flex h-7 shrink-0 items-center gap-2 rounded-full bg-(--color-raised) px-3 whitespace-nowrap text-(--color-foreground)";

/** 分支面板主体：任意触发器 + 搜索/列表/新建/图谱内容。 */
export function BranchPickerPopover({
  t,
  root,
  current,
  onSwitched,
  onError,
  onOpenGraph,
  trigger,
  side = "bottom",
  align = "start",
}: PopoverProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [uncommitted, setUncommitted] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const createRef = useRef<HTMLInputElement>(null);

  // 打开时拉分支列表与未提交统计；关闭时重置搜索/新建态。
  useEffect(() => {
    if (!open) {
      setQuery("");
      setCreating(false);
      setNewName("");
      return;
    }
    if (!hasBridge() || root === "") return;
    let cancelled = false;
    void api
      .workspaceGitBranches(root)
      .then((data) => {
        if (!cancelled) setBranches(data?.branches ?? []);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    void api
      .workspaceGitChanges(root)
      .then((changes) => {
        if (!cancelled) setUncommitted(changes?.changedFiles ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, root]);

  useEffect(() => {
    if (creating) requestAnimationFrame(() => createRef.current?.focus());
  }, [creating]);

  const checkout = (name: string, create: boolean): void => {
    const branch = name.trim();
    if (!branch) return;
    void api
      .workspaceGitCheckout(root, branch, create)
      .then((result) => {
        if (result.ok && result.branch) {
          setOpen(false);
          onSwitched(result.branch);
        } else {
          onError(`${t("branch.switchFailed")}${result.error ? `：${result.error}` : ""}`);
        }
      })
      .catch(() => onError(t("branch.switchFailed")));
  };

  const q = query.trim().toLowerCase();
  const filtered = (branches ?? [])
    .filter((name) => (q === "" ? true : name.toLowerCase().includes(q)))
    .sort((a, b) => (a === current ? -1 : b === current ? 1 : a.localeCompare(b)));

  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={6}
          className="dropdown-in z-50 w-[300px] rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-1.5 shadow-(--shadow-pop)"
        >
          <div className="mb-1 flex items-center gap-2 rounded-md bg-(--color-surface) px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-(--color-faint)" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("branch.search")}
              aria-label={t("branch.search")}
              className="w-full bg-transparent outline-none placeholder:text-(--color-faint)"
            />
          </div>
          <div className="px-2.5 pt-1 pb-1 text-(--color-faint)">{t("branch.section")}</div>
          <div className="scrollbar-thin max-h-[240px] overflow-y-auto">
            {filtered.map((name) => {
              const active = name === current;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => !active && checkout(name, false)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none ${
                    active ? "bg-(--color-selected) text-(--color-foreground)" : "text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
                  }`}
                >
                  <GitBranch size={13} strokeWidth={1.3} className="shrink-0 text-(--color-muted)" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{name}</span>
                    {active && uncommitted !== null && uncommitted > 0 && (
                      <span className="block text-(--color-faint)">
                        {t("branch.uncommitted").replace("{n}", String(uncommitted))}
                      </span>
                    )}
                  </span>
                  {active && <Check size={13} className="shrink-0 text-(--color-accent)" />}
                </button>
              );
            })}
          </div>
          <div className="my-1 h-px bg-(--color-hairline)" />
          {creating ? (
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5">
              <Plus size={13} className="shrink-0 text-(--color-muted)" />
              <input
                ref={createRef}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") checkout(newName, true);
                  if (event.key === "Escape") setCreating(false);
                }}
                placeholder={t("branch.createPlaceholder")}
                aria-label={t("branch.createPlaceholder")}
                className="w-full bg-transparent font-mono outline-none placeholder:text-(--color-faint)"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-(--color-muted) outline-none hover:bg-(--color-hover) hover:text-(--color-foreground)"
            >
              <Plus size={13} className="shrink-0" />
              {t("branch.create")}
            </button>
          )}
          <button
            type="button"
            disabled={!onOpenGraph}
            aria-description={onOpenGraph ? undefined : t("titlebar.menu.comingSoon")}
            title={onOpenGraph ? t("branch.graph") : t("titlebar.menu.comingSoon")}
            onClick={() => {
              setOpen(false);
              onOpenGraph?.();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-(--color-muted) outline-none hover:bg-(--color-hover) hover:text-(--color-foreground) disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-(--color-muted)"
          >
            <Network size={13} className="shrink-0" />
            {t("branch.graph")}
          </button>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/** 标题栏分支胶囊：current 为 null 时整体隐藏（对齐参考规则）。 */
export function BranchPicker({ t, root, current, onSwitched, onError, onOpenGraph }: BranchPickerBaseProps): React.JSX.Element | null {
  if (current === null) return null;

  const interactive = hasBridge() && root !== "";
  const trigger = (
    <button type="button" disabled={!interactive} title={current} className={`${pill} outline-none ${interactive ? "hover:bg-(--color-hover)" : ""}`}>
      <GitBranch size={14} strokeWidth={1.3} className="shrink-0 text-(--color-muted)" />
      <span className="max-w-[140px] truncate font-mono">{current}</span>
      <ChevronDown size={12} className="text-(--color-faint)" />
    </button>
  );
  if (!interactive) return trigger;

  return (
    <BranchPickerPopover t={t} root={root} current={current} onSwitched={onSwitched} onError={onError} onOpenGraph={onOpenGraph} trigger={trigger} />
  );
}
