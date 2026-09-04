// 桌面通知（taskNotifications 设置）：回合完成/失败与权限请求到达时，主窗
// 口不在聚焦使用态才发系统通知；点击通知显示并聚焦主窗口（由组合侧注入的
// 发送口负责）。决策面为纯函数，本模块无 Electron——设置/窗口/会话/发送
// 全部经端口注入，组合在 harnessGlue。

/** 通知事件类别：回合完成 / 回合失败 / 需要确认（权限请求）。 */
export type DesktopNotifyKind = "completed" | "failed" | "permission";

export interface DesktopNotifyState {
  /** taskNotifications !== false。 */
  enabled: boolean;
  /** 主窗口处于聚焦使用态（聚焦且可见且未最小化）时免打扰。 */
  windowFocused: boolean;
}

/** 是否发送（纯函数）：设置开启且窗口未聚焦。 */
export function shouldNotify(state: DesktopNotifyState): boolean {
  return state.enabled && !state.windowFocused;
}

const BODY_TEXT: Record<DesktopNotifyKind, string> = {
  completed: "任务完成",
  failed: "任务失败",
  permission: "需要确认",
};

/** 通知正文（zh，纯函数）。 */
export function desktopNotifyBody(kind: DesktopNotifyKind): string {
  return BODY_TEXT[kind];
}

export interface DesktopNotifyPorts {
  /** 当前设置投影（惰性读取，live 跟随设置变更）。 */
  settings(): { taskNotifications?: boolean; notificationSound?: boolean };
  /** 主窗口是否处于聚焦使用态。 */
  windowFocused(): boolean;
  /** 会话标题（未知会话 → undefined，回退应用名）。 */
  sessionTitle(sessionId: string): string | undefined;
  /** 应用名（无标题会话的通知标题回退）。 */
  appName(): string;
  /** 系统通知发送口（Electron Notification 薄壳由组合侧注入）。 */
  send(input: { title: string; body: string; silent: boolean }): void;
}

export interface DesktopNotifier {
  notify(kind: DesktopNotifyKind, sessionId: string, options?: { aborted?: boolean }): void;
}

export function createDesktopNotifier(ports: DesktopNotifyPorts): DesktopNotifier {
  return {
    notify(kind, sessionId, options) {
      // 用户主动停止的回合不通知——用户正在操作，免打扰。
      if (options?.aborted === true) return;
      const settings = ports.settings();
      const allowed = shouldNotify({
        enabled: settings.taskNotifications !== false,
        windowFocused: ports.windowFocused(),
      });
      if (!allowed) return;
      try {
        ports.send({
          title: ports.sessionTitle(sessionId) ?? ports.appName(),
          body: desktopNotifyBody(kind),
          silent: settings.notificationSound === false,
        });
      } catch {
        // 系统通知失败（无通知中心等）不影响回合流程。
      }
    },
  };
}
