// 标题栏分支面板（对齐参考）：胶囊触发 → 搜索 + 本地分支列表（当前分支置顶、
// 带未提交更改统计）+ 创建并检出新分支 + Git 图谱（占位）。检出走 workspaceGitCheckout。
import { useEffect, useRef, useState } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Check, ChevronDown, GitBranch, Network, Plus, Search } from "lucide-react";
import { api, hasBridge } from "../lib/ipc";

interface Props {
  t: (key: string) => string;
  /** 会话工作区根；空 = 无项目上下文（退化为不可点的静态胶囊）。 */
  root: string;
  /** 当前分支（null = 未检测/非仓库，整体隐藏，对齐参考规则）。 */
  current: string | null;
  onSwitched: (branch: string) => void;
  onError: (message: string) => void;
}

const pill =
  "app-no-drag ml-3 flex h-7 shrink-0 items-center gap-2 rounded-full bg-(--color-raised) px-3 whitespace-nowrap text-(--color-foreground)";

export function BranchPicker({ t, root, current, onSwitched, onError }: Props): React.JSX.Element | null {
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
          align="start"
          side="bottom"
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
            disabled
            aria-description={t("titlebar.menu.comingSoon")}
            title={t("titlebar.menu.comingSoon")}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-(--color-muted) disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Network size={13} className="shrink-0" />
            {t("branch.graph")}
          </button>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
