import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Plus, Square, ArrowUp, Files, Play, LoaderCircle } from "lucide-react";
import {
  MOCK_MODEL,
  MOCK_PROFILE_ID,
  type HarnessSettings,
  type ProviderProfile,
} from "../../../shared/ipc";
import { ModelPicker } from "./composer/ModelPicker";
import { PermissionModePicker } from "./composer/PermissionModePicker";
import { AgentModePicker, type AgentModeOption } from "./composer/AgentModePicker";
import { ThinkingEffortPicker } from "./composer/ThinkingEffortPicker";

interface Props {
  t: (key: string) => string;
  /** landing shows project selection and contextual input guidance; existing is compact follow-up mode. */
  mode?: "landing" | "existing";
  contextCount?: number;
  contentMaxWidth?: number;
  contentGutter?: number;
  frameMaxWidth?: number;
  companionWidth?: number;
  companionGap?: number;
  streaming: boolean;
  settings: HarnessSettings | null;
  /** agent 模式目录（缺省回落仅内置 default，App 层经 useAgentModes 注入）。 */
  agentModes?: AgentModeOption[];
  onSettingsChange: (patch: Partial<HarnessSettings>) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** S1 后台运行入口：同段输入改走后台作业；缺省不渲染按钮。 */
  onBackgroundRun?: (text: string) => void;
  /** 引用通道注入文本：并入输入框后立即回调 onConsumed 清掉 draft。 */
  initialText?: string;
  onConsumed?: () => void;
  /** 面板首行（落地态的项目选择器；聊天态不传 = 无此行）。 */
  header?: ReactNode;
}

/** 参考稿输入盒：raised 灰盒 + 12px 圆角；运行时边框光束（beam）循环游走。 */
export function Composer({
  t,
  mode,
  contextCount = 0,
  contentMaxWidth,
  contentGutter,
  frameMaxWidth,
  companionWidth = 0,
  companionGap = 0,
  streaming,
  settings,
  agentModes,
  onSettingsChange,
  onSend,
  onStop,
  onBackgroundRun,
  initialText,
  onConsumed,
  header,
}: Props): React.JSX.Element {
  const composerMode = mode ?? (header ? "landing" : "existing");
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!initialText) return;
    setValue((v) => (v ? `${v}\n${initialText}` : initialText));
    onConsumed?.();
    requestAnimationFrame(() => ref.current?.focus());
    // 依赖只含 initialText：onConsumed 后 draft 已清空，回调引用不触发重复并入。
  }, [initialText]);

  // 自适应高度跟随值变化：发送清空后回弹、引用注入后长高（onChange 之外
  // 的值变更没有输入事件，必须在这里补）。
  useEffect(() => {
    const el = ref.current;
    if (el) autosize(el);
  }, [value]);

  const submit = (): void => {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(() => ref.current?.focus());
  };

  // S1 后台运行：同一段输入走后台作业（新会话 + 机器身份触发 + 状态通知）。
  const submitBackground = (): void => {
    const text = value.trim();
    if (!text || streaming || !onBackgroundRun) return;
    onBackgroundRun(text);
    setValue("");
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = value.trim().length > 0 && !streaming;
  // Mock 是虚拟厂家（不在 settings.profiles 中）——组装层注入伪 profile，
  // 保持旧 select 的能力：chip 显示「本地 Mock」，且可从面板切回 mock。
  const pickerSettings: HarnessSettings | null = settings
    ? {
        ...settings,
        profiles: settings.profiles.some((p) => p.id === MOCK_PROFILE_ID)
          ? settings.profiles
          : [mockProfile(t), ...settings.profiles],
      }
    : null;

  // 反色方形动作钮（参考稿 stop-btn）：暗底上亮块 / 亮底上墨块。
  const squareButton =
    "grid size-5 shrink-0 place-items-center rounded-[6px] bg-(--color-app-strong) text-(--color-app-panel) transition-transform active:scale-90 disabled:opacity-30";

  return (
    <div className="shrink-0 pb-[clamp(10px,1.5vw,16px)]" style={{ paddingInline: contentGutter }}>
      <div className="mx-auto flex w-full items-end" style={{ maxWidth: frameMaxWidth, gap: companionGap }}>
      <div data-testid="chat-composer" className="chat-column" style={{ maxWidth: contentMaxWidth }}>
        <div
          className={`flex min-h-[105px] flex-col justify-between rounded-[12px] border border-(--color-app-border) bg-(--color-app-raised) transition-colors focus-within:border-(--color-app-accent) ${streaming ? "beam" : ""}`}
        >
          {composerMode === "landing" && header && <div className="px-3 pt-3">{header}</div>}
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              autosize(e.target);
            }}
            onKeyDown={onKeyDown}
            placeholder={t(composerMode === "landing" ? "chat.placeholder" : "chat.placeholder.followUp")}
            rows={1}
            className="scrollbar-thin max-h-44 min-h-9 w-full flex-1 resize-none bg-transparent px-3 pt-3.5 text-[13.5px] leading-relaxed outline-none placeholder:text-(--color-app-muted) disabled:opacity-50"
          />
          {composerMode === "landing" && (
            <div className="flex flex-wrap gap-x-3 px-3 pt-1 text-[10px] text-(--color-app-faint)">
              <span>使用 @ 添加上下文</span>
              <span>使用 / 选择命令或能力</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 px-3 pb-2.5 pt-1.5 text-[13px] text-(--color-app-muted)">
            <button
              type="button"
              aria-label="添加附件"
              aria-description="当前会话不支持附件上下文"
              disabled
              className="grid size-7 shrink-0 cursor-not-allowed place-items-center rounded-md opacity-45"
            >
              <Plus size={17} strokeWidth={1.5} />
            </button>
            <PermissionModePicker
              t={t}
              value={settings?.permissionMode ?? "ask"}
              onChange={(mode) => onSettingsChange({ permissionMode: mode })}
            />
            <AgentModePicker
              t={t}
              value={settings?.activeAgentMode ?? "default"}
              options={agentModes ?? [{ id: "default", title: "Default" }]}
              onChange={(mode) => onSettingsChange({ activeAgentMode: mode })}
            />
            {composerMode === "existing" && (
              <span className="inline-flex items-center gap-1 text-[12px] text-(--color-app-muted)" aria-label="上下文数量">
                <Files size={12} />{contextCount}
              </span>
            )}
            <div className="flex-1" />

            {streaming && <LoaderCircle size={14} className="shrink-0 animate-spin" aria-label="streaming" />}

            {pickerSettings ? (
              <ModelPicker
                settings={pickerSettings}
                activeProfileId={pickerSettings.activeProfileId}
                activeModel={pickerSettings.activeModel}
                onSelect={(profileId, modelId) =>
                  onSettingsChange({ activeProfileId: profileId, activeModel: modelId })
                }
              />
            ) : (
              <button
                type="button"
                disabled
                className="flex max-w-[200px] items-center gap-1 text-[13px] font-medium"
              >
                <span className="truncate">{t("provider.mock")}</span>
              </button>
            )}

            {composerMode === "existing" && (
              <ThinkingEffortPicker
                t={t}
                value={settings?.reasoningEffort ?? ""}
                onChange={(effort) => onSettingsChange({ reasoningEffort: effort })}
              />
            )}

            {!streaming && onBackgroundRun && (
              <button
                type="button"
                onClick={submitBackground}
                disabled={!canSend}
                aria-label={t("chat.backgroundRun")}
                title={t("chat.backgroundRun")}
                className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-(--color-app-bubble) transition-transform active:scale-90 disabled:opacity-30"
              >
                <Play size={11} />
              </button>
            )}

            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label={t("chat.stop")}
                title={t("chat.stop")}
                className={squareButton}
              >
                <Square size={10} fill="currentColor" strokeWidth={0} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label={t("chat.send")}
                title={t("chat.send")}
                className={squareButton}
              >
                <ArrowUp size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>
      {companionWidth > 0 && <div aria-hidden="true" className="shrink-0" style={{ width: companionWidth }} />}
      </div>
    </div>
  );
}

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
}

function mockProfile(t: (key: string) => string): ProviderProfile {
  return {
    id: MOCK_PROFILE_ID,
    name: t("provider.mock"),
    kind: "openai",
    apiKey: "",
    baseURL: "",
    enabled: true,
    models: [{ id: MOCK_MODEL, name: t("provider.mock"), source: "preset" }],
  };
}
