// 会话内附件摄入校验（规格 §5 plugin-attachments 的会话半边）：消息处理器
// 在用户输入进入循环前校验附件 part——单消息件数上限、引用与表示形状。
// 内容存在性（CAS 对象在位）与模型能力门控是宿主（主进程）的权威职责，
// 本插件不做 IO（无状态、可在任意宿主装载）。
import type { Context } from "@innocenceharness/kernel";
import { isContentRef, type AttachmentPart, type Message } from "@innocenceharness/harness-session";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@innocenceharness/attachment-runtime";

/** 技能展开（-1000）之后、宿主处理器（0）之前：校验看到的是最终输入。 */
const ATTACHMENT_VALIDATION_ORDER = -500;

/** 校验失败原因（抛错文案由宿主呈现；中文面向用户）。 */
export function attachmentValidationError(message: Message): string | null {
  const attachments = message.parts.filter((part): part is AttachmentPart => part.type === "attachment");
  if (attachments.length === 0) return null;
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return `单条消息最多 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件（当前 ${attachments.length} 个）`;
  }
  for (const part of attachments) {
    if (!part.name || part.name.trim().length === 0) return "附件缺少名称";
    if (!isContentRef(part.source)) return `附件 ${part.name} 的原始对象引用不合法`;
    if (!Array.isArray(part.representations)) return `附件 ${part.name} 的表示列表不合法`;
    for (const representation of part.representations) {
      if (representation.kind !== "text" && representation.kind !== "image") {
        return `附件 ${part.name} 含未知表示类型`;
      }
      if (!isContentRef(representation.content)) {
        return `附件 ${part.name} 的${representation.kind === "text" ? "文本" : "图像"}表示引用不合法`;
      }
    }
  }
  return null;
}

/** Kernel-native attachments validator plugin (name "attachments"). */
export interface AttachmentsPlugin {
  readonly name: "attachments";
  apply(ctx: Context): Promise<void>;
}

export function createAttachmentsPlugin(): AttachmentsPlugin {
  return {
    name: "attachments",
    async apply(ctx) {
      ctx.session.registerProcessor({
        name: "attachment-validation",
        order: ATTACHMENT_VALIDATION_ORDER,
        process: async (message) => {
          if (message.role !== "user") return message;
          const error = attachmentValidationError(message);
          if (error) throw new Error(error);
          return message;
        },
      });
    },
  };
}

// Distribution default: the plugin object itself (plain mount, no factory config).
export default createAttachmentsPlugin;
