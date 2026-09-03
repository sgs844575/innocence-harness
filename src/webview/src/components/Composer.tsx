// 输入卡：raised 面 + 16px 圆角。落地态带项目/分支顶行；底行 = 「+」上下文
// 菜单、权限模式、模型两级选择器、思考强度、发送/停止反色方形钮。
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Plus, Square, ArrowUp, AtSign, Paperclip, Slash } from "lucide-react";
import type { HarnessSettings, PermissionMode } from "../../../shared/ipc";
import { ModelPicker } from "./composer/ModelPicker";
import { PermissionModePicker } from "./composer/PermissionModePicker";
import { AgentModePicker } from "./composer/AgentModePicker";
import { ThinkingEffortPicker, type EffortValue } from "./composer/ThinkingEffortPicker";
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
  /** 面板首行（落地态的项目/分支选择器）；聊天态不传 = 无此行。 */
  header?: ReactNode;
  /** 快捷动作注入的草稿。 */
  draft?: ComposerDraft;
  /** 模型选择器「管理模型」入口（跳设置模型分区）。 */
  onManageModels?: () => void;
}

export function Composer({
  t,
  mode,
  streaming,
  settings,
  onPatchSettings,
  onSend,
  onStop,
  header,
  draft,
  onManageModels,
}: Props): React.JSX.Element {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const agentModes = useAgentModes();

  useEffect(() => {
    const el = ref.current;
    if (el) autosize(el);
  }, [value]);

  // 快捷动作草稿注入：nonce 变化时整体替换文本并聚焦。
  useEffect(() => {
    if (!draft) return;
    setValue(draft.text);
    requestAnimationFrame(() => ref.current?.focus());
  }, [draft]);

  const submit = (): void => {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // 「+」菜单：把 @ / / 前导符写入输入框并聚焦（已带前导符则不重复）。
  const insertPrefix = (prefix: string): void => {
    setValue((current) => (current.startsWith(prefix) ? current : `${prefix}${current}`));
    requestAnimationFrame(() => ref.current?.focus());
  };

  const canSend = value.trim().length > 0 && !streaming;

  // 反色圆角动作钮（参考规格）：品牌底（暗色=白）+ 反色图标。
  const squareButton =
    "grid size-7 shrink-0 place-items-center rounded-lg bg-(--color-brand) text-(--color-inverse) transition-opacity hover:opacity-80 active:scale-95 disabled:opacity-30";

  return (
    <div data-testid="chat-composer" className="w-full">
      <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-raised) p-3 transition-colors hover:border-(--color-border-hover) focus-within:border-(--color-border-hover)">
        {mode === "landing" && header && <div className="px-0.5 pt-0.5">{header}</div>}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={onKeyDown}
          placeholder={t(mode === "landing" ? "chat.placeholder" : "chat.placeholder.followUp")}
          rows={1}
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
