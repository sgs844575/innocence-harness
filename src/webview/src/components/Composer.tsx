// 输入卡：raised 面 + 16px 圆角。落地态带项目/分支顶行；底行 = 「+」上下文
// 菜单、权限模式、模型两级选择器、思考强度、发送/停止反色方形钮。
// @ / / 前导符触发补全弹层（文件上下文 / 技能命令，composer/suggest 家族）。
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Plus, Square, ArrowUp, AtSign, Paperclip, Slash } from "lucide-react";
import type { ChatContextUsageSnapshot, HarnessSettings, PermissionMode } from "../../../shared/ipc";
import { ModelPicker } from "./composer/ModelPicker";
import { PermissionModePicker } from "./composer/PermissionModePicker";
import { AgentModePicker } from "./composer/AgentModePicker";
import { ThinkingEffortPicker, type EffortValue } from "./composer/ThinkingEffortPicker";
import { ContextMeter } from "./composer/ContextMeter";
import { ComposerSuggest, type SuggestRow } from "./composer/ComposerSuggest";
import {
  applySuggestion,
  detectSuggestToken,
  filterFileItems,
  filterSkillItems,
} from "./composer/suggest";
import { useSkillCatalog, useWorkspaceFileList } from "./composer/useSuggestData";
import { DropdownMenu, DropdownMenuItem } from "./ui/DropdownMenu";
import { useAgentModes } from "../state/useAgentModes";

/** 外部注入的草稿（落地页快捷动作填入）：nonce 变化时整体替换并聚焦。 */
export interface ComposerDraft {
  text: string;
  nonce: number;
}

interface Props {
  t: (key: string) => string;
  /** landing = 落地页居中卡（顶行项目选择）；existing = 会话底部输入栏。 */
  mode: "landing" | "existing";
  streaming: boolean;
  settings: HarnessSettings | null;
  onPatchSettings: (patch: Partial<HarnessSettings>) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** 会话/落地态的项目根（@ 文件补全数据源）；缺省 = 未绑定。 */
  workspaceRoot?: string;
  /** 面板首行（落地态的项目/分支选择器）；聊天态不传 = 无此行。 */
  header?: ReactNode;
  /** 快捷动作注入的草稿。 */
  draft?: ComposerDraft;
  /** 模型选择器「管理模型」入口（跳设置模型分区）。 */
  onManageModels?: () => void;
  /** 上下文容量快照：undefined = 不渲染指示器（落地页/辅助对话）；
   *  null = 渲染 0% 灰环（会话内常显，快照未到）。 */
  contextUsage?: ChatContextUsageSnapshot | null;
}

export function Composer({
  t,
  mode,
  streaming,
  settings,
  onPatchSettings,
  onSend,
  onStop,
  workspaceRoot = "",
  header,
  draft,
  onManageModels,
  contextUsage,
}: Props): React.JSX.Element {
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  // Esc 关闭后同 token 内保持关闭；token 归零（弹层自然收起）后复位。
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const agentModes = useAgentModes();
  const listboxId = useId();

  useEffect(() => {
    const el = ref.current;
    if (el) autosize(el);
  }, [value]);

  // 快捷动作草稿注入：nonce 变化时整体替换文本并聚焦。
  useEffect(() => {
    if (!draft) return;
    setValue(draft.text);
    setCaret(draft.text.length);
    requestAnimationFrame(() => ref.current?.focus());
  }, [draft]);

  // ---- @ 文件 / / 技能补全 ----------------------------------------------------

  const token = useMemo(() => detectSuggestToken(value, caret), [value, caret]);
  const kind = token?.kind;
  const suggestOpen = token !== null && !dismissed;
  const skills = useSkillCatalog(suggestOpen && kind === "slash", workspaceRoot);
  const files = useWorkspaceFileList(suggestOpen && kind === "at", workspaceRoot);

  const rows = useMemo<SuggestRow[]>(() => {
    if (!token) return [];
    if (token.kind === "slash") {
      return filterSkillItems(skills.items, token.query).map((skill) => ({
        key: skill.name,
        title: `/${skill.name}`,
        sub: skill.description,
        insert: skill.name,
      }));
    }
    return filterFileItems(files.items, token.query).map((file) => ({
      key: file.path,
      title: file.name,
      sub: file.dir,
      insert: file.path,
    }));
  }, [token, skills.items, files.items]);

  // token 变更（种类/位置/过滤词）重置活动行；行数收缩时读侧钳制。
  useEffect(() => {
    setActiveIndex(0);
  }, [kind, token?.start, token?.query]);
  // Esc 关闭只对当前 token 生效：换 token（种类/起点变化，含归零后新起）即复位
  // ——否则选中重打替换一个已关闭的 @ 词时永远打不开弹层。
  const tokenKey = token === null ? null : `${token.kind}:${token.start}`;
  const prevTokenKey = useRef<string | null>(null);
  useEffect(() => {
    if (tokenKey !== prevTokenKey.current) {
      prevTokenKey.current = tokenKey;
      setDismissed(false);
    }
  }, [tokenKey]);
  const active = Math.min(activeIndex, Math.max(rows.length - 1, 0));

  const accept = (index: number): void => {
    if (!token) return;
    const row = rows[index];
    if (!row) return;
    const next = applySuggestion(value, token, `${token.kind === "slash" ? "/" : "@"}${row.insert} `);
    setValue(next.value);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  };

  const submit = (): void => {
    const text = value.trim();
    // 流式中允许发送：主进程按 interactionMode 排队/引导（输入框照常清空、
    // 消息立即上屏）；流式中的可见动作钮仍是停止（见下方按钮分支）。
    if (!text) return;
    onSend(text);
    setValue("");
    setCaret(0);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // 补全弹层键盘路由（IME 组合中不拦——Enter 属于候选确认）。
    if (suggestOpen && !e.nativeEvent.isComposing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (rows.length > 0) {
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? 1 : -1;
          setActiveIndex((active + delta + rows.length) % rows.length);
        }
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && rows.length > 0) {
        e.preventDefault();
        accept(active);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // 「+」菜单：把 @ / / 前导符写入输入框并聚焦（已带前导符则不重复）；
  // 前导符本身即补全 token，弹层随之打开——菜单点击是显式意图，必解除 Esc 关闭。
  const insertPrefix = (prefix: string): void => {
    setValue((current) => (current.startsWith(prefix) ? current : `${prefix}${current}`));
    setCaret(prefix.length);
    setDismissed(false);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(prefix.length, prefix.length);
      }
    });
  };

  // 发送门槛只看输入是否有内容：流式中回车仍可发送（排队/引导由主进程
  // 决定）；按钮禁用面仍叠加 !streaming（流式中按钮是停止，永不禁用）。
  const canSend = value.trim().length > 0;

  // 反色圆角动作钮（参考规格）：品牌底（暗色=白）+ 反色图标。
  const squareButton =
    "grid size-7 shrink-0 place-items-center rounded-lg bg-(--color-brand) text-(--color-inverse) transition-opacity hover:opacity-80 active:scale-95 disabled:opacity-30";

  return (
    <div data-testid="chat-composer" className="relative w-full">
      {suggestOpen && (
        <ComposerSuggest
          t={t}
          kind={token!.kind}
          rows={rows}
          loading={token!.kind === "slash" ? skills.loading : files.loading}
          noWorkspace={workspaceRoot.trim() === ""}
          activeIndex={active}
          listboxId={listboxId}
          onHover={setActiveIndex}
          onAccept={accept}
        />
      )}
      <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-raised) p-3 transition-colors hover:border-(--color-border-hover) focus-within:border-(--color-border-hover)">
        {mode === "landing" && header && <div className="px-0.5 pt-0.5">{header}</div>}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            autosize(e.target);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          placeholder={t(mode === "landing" ? "chat.placeholder" : "chat.placeholder.followUp")}
          rows={1}
          aria-expanded={suggestOpen}
          aria-controls={suggestOpen ? listboxId : undefined}
          aria-activedescendant={suggestOpen && rows.length > 0 ? `${listboxId}-opt-${active}` : undefined}
          className="scrollbar-thin max-h-40 min-h-10 w-full flex-1 resize-none bg-transparent px-1 pt-1 leading-relaxed outline-none placeholder:text-(--color-faint) disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center gap-3 text-(--color-muted)">
          {/* 「+」添加上下文菜单：附件暂不可用（禁用项带原因说明）。 */}
          <DropdownMenu
            contentClassName="w-52"
            trigger={
              <button
                type="button"
                aria-label={t("composer.addContext")}
                title={t("composer.addContext")}
                className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-(--color-hover)"
              >
                <Plus size={17} strokeWidth={1.5} />
              </button>
            }
          >
            <DropdownMenuItem disabled description={t("composer.attachUnavailable")}>
              <span className="flex items-center gap-2">
                <Paperclip size={13} className="text-(--color-muted)" />
                {t("composer.attach")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => insertPrefix("@")}>
              <span className="flex items-center gap-2">
                <AtSign size={13} className="text-(--color-muted)" />
                {t("chat.hint.at")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => insertPrefix("/")}>
              <span className="flex items-center gap-2">
                <Slash size={13} className="text-(--color-muted)" />
                {t("chat.hint.slash")}
              </span>
            </DropdownMenuItem>
          </DropdownMenu>

          <PermissionModePicker
            t={t}
            value={settings?.permissionMode ?? "ask"}
            onChange={(mode: PermissionMode) => onPatchSettings({ permissionMode: mode })}
          />

          <AgentModePicker
            t={t}
            modes={agentModes}
            value={settings?.activeAgentMode ?? "default"}
            onChange={(id) => onPatchSettings({ activeAgentMode: id })}
          />

          <div className="flex-1" />

          {/* 上下文容量环：undefined 不渲染；插在模型选择器左侧。 */}
          {contextUsage !== undefined && <ContextMeter t={t} snapshot={contextUsage} />}

          {settings ? (
            <ModelPicker
              t={t}
              settings={settings}
              activeProfileId={settings.activeProfileId}
              activeModel={settings.activeModel}
              onSelect={(profileId, modelId) => onPatchSettings({ activeProfileId: profileId, activeModel: modelId })}
              onManageModels={onManageModels}
            />
          ) : (
            <button type="button" disabled className="flex max-w-[200px] items-center gap-1 font-medium">
              <span className="truncate">{t("provider.mock")}</span>
            </button>
          )}

          <ThinkingEffortPicker
            t={t}
            value={(settings?.reasoningEffort ?? "") as EffortValue}
            onChange={(effort) => onPatchSettings({ reasoningEffort: effort })}
          />

          <button
            type="button"
            onClick={streaming ? onStop : submit}
            disabled={!streaming && !canSend}
            aria-label={streaming ? t("chat.stop") : t("chat.send")}
            title={streaming ? t("chat.stop") : t("chat.send")}
            className={squareButton}
          >
            {streaming ? (
              <Square key="stop" size={16} fill="currentColor" strokeWidth={0} className="icon-swap size-4" />
            ) : (
              <ArrowUp key="send" size={16} strokeWidth={2} className="icon-swap size-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
}
