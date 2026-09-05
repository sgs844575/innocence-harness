// dock 辅助对话页：独立 aux 会话的完整聊天面（消息时间线 + 权限卡 + Composer），
// 复用主聊天的流式 hook 与组件；会话由 dock 标签持有（aux 标记，不进侧边栏）。
import { useEffect, useRef } from "react";
import type { HarnessSettings, PermissionChoice } from "../../../shared/ipc";
import { useChatStream } from "../state/useChatStream";
import { MessageItem } from "./MessageItem";
import { PermissionCard } from "./PermissionCard";
import { Composer } from "./Composer";
import { streamDisplayFromSettings } from "./chat/toolGrouping";
import { activeModelVision } from "../lib/modelVision";
import { DEFAULT_CODE_THEME_DARK, DEFAULT_CODE_THEME_LIGHT } from "../../../shared/codeThemes";

interface Props {
  t: (key: string) => string;
  /** 该标签绑定的 aux 会话 id（创建标签时即建）。 */
  sessionId: string;
  settings: HarnessSettings | null;
  onPatchSettings: (patch: Partial<HarnessSettings>) => void;
  onManageModels?: () => void;
  onError: (message: string) => void;
}

export function AuxChatView({ t, sessionId, settings, onPatchSettings, onManageModels, onError }: Props): React.JSX.Element {
  const chat = useChatStream({
    activeId: sessionId,
    ensureSessionForSend: () => Promise.resolve(sessionId),
    onError,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  // 方向感知钉底（同主时间线规则）：用户上滚 >48px 释放，否则新内容保持贴底。
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);
  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const code = {
    light: settings?.codeThemeLight ?? DEFAULT_CODE_THEME_LIGHT,
    dark: settings?.codeThemeDark ?? DEFAULT_CODE_THEME_DARK,
    lineNumbers: settings?.codeLineNumbers !== false,
  };
  // 消息流显示开关（思考/todo/工具分组），与主时间线同律。
  const streamDisplay = streamDisplayFromSettings(settings);
  return (
    <div data-testid="aux-chat" className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-3 py-4">
          {chat.messages.map((message) => (
            <MessageItem key={message.id} t={t} message={message} code={code} stream={streamDisplay} />
          ))}
        </div>
      </div>
      {chat.permission && (
        <div className="shrink-0 px-3 pb-2">
          <PermissionCard
            t={t}
            request={chat.permission}
            onRespond={(requestId: string, choice: PermissionChoice) => void chat.respondPermission(requestId, choice)}
          />
        </div>
      )}
      <div className="shrink-0 px-3 pb-3">
        <Composer
          t={t}
          mode="existing"
          streaming={chat.streaming}
          settings={settings}
          onPatchSettings={onPatchSettings}
          onSend={(text, attachments) => void chat.send(text, attachments)}
          onStop={() => void chat.stop()}
          workspaceRoot={settings?.workspaceRoot ?? ""}
          onManageModels={onManageModels}
          visionSupported={activeModelVision(settings)}
        />
      </div>
    </div>
  );
}
