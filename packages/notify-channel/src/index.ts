import * as imSdk from "@larksuiteoapi/node-sdk";

/** 通知通道凭据与投递目标（声明式配置的归一形态）。 */
export interface NotifyChannelOptions {
  appId: string;
  appSecret: string;
  /** 接收者标识值（群或用户，随 receiveIdType 语义）。 */
  receiveId: string;
  /** 接收者标识类型；缺省群标识。 */
  receiveIdType?: "chat_id" | "open_id" | "user_id" | "union_id";
  /** 通道服务域名；缺省用通道 SDK 的默认站，字符串原样透传。 */
  domain?: string;
}

/** 单条通知的最小形态：一行标题 + 正文。 */
export interface NotifyMessage {
  title: string;
  text: string;
}

/** 消费方（自动化分发等）持有的最小通知面；本包提供通道实现。 */
export interface NotifySink {
  send(message: NotifyMessage): Promise<void>;
}

export interface NotifyChannelDependencies {
  /** 消息发送面；缺省构造通道 SDK 客户端，仅测试注入。 */
  sendMessage?: (message: NotifyMessage) => Promise<void>;
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`notify channel ${label} is required`);
  return trimmed;
}

/**
 * 通道 SDK 客户端发送面：首次发送时才构造客户端（凭据校验后惰性加载），
 * 文本消息按「标题 + 空行 + 正文」投递；发送失败原样上抛给调用方裁决。
 */
function channelSender(options: NotifyChannelOptions): (message: NotifyMessage) => Promise<void> {
  let client: imSdk.Client | undefined;
  const receiveIdType = options.receiveIdType ?? "chat_id";
  return async (message) => {
    client ??= new imSdk.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      ...(options.domain ? { domain: options.domain } : {}),
    });
    await client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: options.receiveId,
        msg_type: "text",
        content: JSON.stringify({ text: `${message.title}\n${message.text}` }),
      },
    });
  };
}

/**
 * 构造通知通道 sink：凭据在构造期即校验（缺项即刻报错，不留暗桩），
 * 客户端在首次发送时惰性构造；测试可注入 sendMessage 替身。
 */
export function createNotifyChannelSink(
  options: NotifyChannelOptions,
  deps: NotifyChannelDependencies = {},
): NotifySink {
  const appId = requiredText(options.appId, "appId");
  const appSecret = requiredText(options.appSecret, "appSecret");
  const receiveId = requiredText(options.receiveId, "receiveId");
  const normalized: NotifyChannelOptions = {
    appId,
    appSecret,
    receiveId,
    ...(options.receiveIdType ? { receiveIdType: options.receiveIdType } : {}),
    ...(options.domain?.trim() ? { domain: options.domain.trim() } : {}),
  };
  const sendMessage = deps.sendMessage ?? channelSender(normalized);
  return {
    async send(message) {
      const title = message.title.trim() || "通知";
      const text = message.text.trim();
      if (!text) throw new Error("notify message text is required");
      await sendMessage({ title, text });
    },
  };
}
