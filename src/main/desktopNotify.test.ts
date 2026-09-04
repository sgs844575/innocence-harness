// 桌面通知决策：shouldNotify 纯函数 + 通知器组合面（端口全注入）。
import { describe, expect, it } from "vitest";
import {
  createDesktopNotifier,
  desktopNotifyBody,
  shouldNotify,
  type DesktopNotifyPorts,
} from "./desktopNotify";

function ports(overrides: Partial<DesktopNotifyPorts> = {}) {
  const sent: { title: string; body: string; silent: boolean }[] = [];
  const base: DesktopNotifyPorts = {
    settings: () => ({}),
    windowFocused: () => false,
    sessionTitle: () => "会话标题",
    appName: () => "TestApp",
    send: (input) => { sent.push(input); },
    ...overrides,
  };
  return { base, sent };
}

describe("shouldNotify", () => {
  it("开启且窗口未聚焦才通知", () => {
    expect(shouldNotify({ enabled: true, windowFocused: false })).toBe(true);
    expect(shouldNotify({ enabled: true, windowFocused: true })).toBe(false);
    expect(shouldNotify({ enabled: false, windowFocused: false })).toBe(false);
  });
});

describe("desktopNotifyBody", () => {
  it("三类事件的正文", () => {
    expect(desktopNotifyBody("completed")).toBe("任务完成");
    expect(desktopNotifyBody("failed")).toBe("任务失败");
    expect(desktopNotifyBody("permission")).toBe("需要确认");
  });
});

describe("createDesktopNotifier", () => {
  it("窗口未聚焦时发送：标题取会话标题，正文按事件类别", () => {
    const { base, sent } = ports();
    const notifier = createDesktopNotifier(base);
    notifier.notify("completed", "sess-1");
    notifier.notify("failed", "sess-1");
    notifier.notify("permission", "sess-1");
    expect(sent).toEqual([
      { title: "会话标题", body: "任务完成", silent: false },
      { title: "会话标题", body: "任务失败", silent: false },
      { title: "会话标题", body: "需要确认", silent: false },
    ]);
  });

  it("窗口聚焦或设置关闭时不发送", () => {
    const focused = ports({ windowFocused: () => true });
    createDesktopNotifier(focused.base).notify("completed", "s");
    expect(focused.sent).toEqual([]);

    const disabled = ports({ settings: () => ({ taskNotifications: false }) });
    createDesktopNotifier(disabled.base).notify("completed", "s");
    expect(disabled.sent).toEqual([]);
  });

  it("aborted 回合不通知；notificationSound === false 置 silent", () => {
    const { base, sent } = ports({ settings: () => ({ notificationSound: false }) });
    const notifier = createDesktopNotifier(base);
    notifier.notify("completed", "s", { aborted: true });
    expect(sent).toEqual([]);
    notifier.notify("completed", "s");
    expect(sent).toEqual([{ title: "会话标题", body: "任务完成", silent: true }]);
  });

  it("未知会话标题回退应用名", () => {
    const { base, sent } = ports({ sessionTitle: () => undefined });
    createDesktopNotifier(base).notify("completed", "ghost");
    expect(sent[0]!.title).toBe("TestApp");
  });

  it("发送口异常不外抛（通知失败不影响回合流程）", () => {
    const { base } = ports({
      send: () => { throw new Error("toast unavailable"); },
    });
    expect(() => createDesktopNotifier(base).notify("completed", "s")).not.toThrow();
  });
});
