// 通知通道的声明式配置：用户级 ~/.innocence/cordis.yml 的 notify 块。
// 缺文件或缺 notify 块返回 undefined（未配置 = 不通知，不报错）；配置损坏
// 经 log 告警后同样按未配置处理。纯读取，无 Electron 依赖。
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { NotifyChannelOptions } from "@innocenceharness/notify-channel";

export type NotifyConfigLogger = (level: "warn", message: string) => void;

const RECEIVE_ID_TYPES = new Set(["chat_id", "open_id", "user_id", "union_id"]);

function requiredText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 读取并归一 notify 配置块；未配置/损坏回落 undefined。 */
export async function loadNotifyChannelConfig(
  home: string = os.homedir(),
  log?: NotifyConfigLogger,
): Promise<NotifyChannelOptions | undefined> {
  const file = path.join(home, ".innocence", "cordis.yml");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (error) {
    log?.("warn", `failed to parse ${file} as yaml; notification channel disabled (${String(error)})`);
    return undefined;
  }
  const notify = (doc as { notify?: unknown } | null)?.notify;
  if (notify === undefined) return undefined;
  if (typeof notify !== "object" || notify === null) {
    log?.("warn", `notify block in ${file} must be a mapping; notification channel disabled`);
    return undefined;
  }
  const record = notify as Record<string, unknown>;
  const appId = requiredText(record.appId);
  const appSecret = requiredText(record.appSecret);
  const receiveId = requiredText(record.receiveId);
  if (!appId || !appSecret || !receiveId) {
    log?.("warn", `notify block in ${file} must declare appId, appSecret and receiveId; notification channel disabled`);
    return undefined;
  }
  const receiveIdType = typeof record.receiveIdType === "string" && RECEIVE_ID_TYPES.has(record.receiveIdType)
    ? (record.receiveIdType as NotifyChannelOptions["receiveIdType"])
    : undefined;
  const domain = typeof record.domain === "string" && record.domain.trim() ? record.domain.trim() : undefined;
  return {
    appId,
    appSecret,
    receiveId,
    ...(receiveIdType ? { receiveIdType } : {}),
    ...(domain ? { domain } : {}),
  };
}
