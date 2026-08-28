// 通知 sink 的惰性组合面：首次发送时才读配置并构造通道 sink；未配置时
// 静默跳过（自动化照常运行，只是不通知）。主进程组合侧专用。
import {
  createNotifyChannelSink,
  type NotifyChannelOptions,
  type NotifySink,
} from "@innocenceharness/notify-channel";
import { loadNotifyChannelConfig } from "./notifyConfig";

export interface LazyNotifySinkDependencies {
  load?: (home?: string) => Promise<NotifyChannelOptions | undefined>;
  factory?: (options: NotifyChannelOptions) => NotifySink;
  home?: string;
}

export function createLazyNotifySink(deps: LazyNotifySinkDependencies = {}): NotifySink {
  const load = deps.load ?? ((home?: string) => loadNotifyChannelConfig(home ?? deps.home));
  const factory = deps.factory ?? createNotifyChannelSink;
  let resolved: NotifySink | undefined;
  let probe: Promise<NotifySink | undefined> | undefined;
  const resolve = (): Promise<NotifySink | undefined> => {
    probe ??= load().then((options) => (options ? factory(options) : undefined));
    return probe;
  };
  return {
    async send(message) {
      resolved = resolved ?? (await resolve());
      // 未配置通道：通知跳过，不视为错误。
      await resolved?.send(message);
    },
  };
}
