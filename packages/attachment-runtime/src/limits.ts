// 附件默认限制（规格 §3）：超限必须在导入/发送前显式报错，永不静默截断。
// 纯常量与纯校验，无 IO。

/** 单附件最大字节数（25 MiB）。 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** 单消息最大附件数。 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** PDF 最大页数。 */
export const MAX_PDF_PAGES = 200;
/** 派生图像最长边（像素）。 */
export const MAX_IMAGE_EDGE = 2048;

/** 导入前限制校验的失败原因（宿主转成用户可读错误）。 */
export type AttachmentLimitError =
  | { kind: "too-large"; byteLength: number; name: string }
  | { kind: "too-many"; count: number };

/** 校验原始导入字节数（超限即拒，不截断）。 */
export function checkImportSize(name: string, byteLength: number): AttachmentLimitError | null {
  return byteLength > MAX_ATTACHMENT_BYTES ? { kind: "too-large", byteLength, name } : null;
}

/** 校验单消息附件数。 */
export function checkMessageAttachmentCount(count: number): AttachmentLimitError | null {
  return count > MAX_ATTACHMENTS_PER_MESSAGE ? { kind: "too-many", count } : null;
}

/** 人类可读限制文案（中文 UI 面；LLM 面不使用本模块）。 */
export function describeAttachmentLimitError(error: AttachmentLimitError): string {
  switch (error.kind) {
    case "too-large":
      return `附件 ${error.name} 超过 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MiB 上限（${formatBytes(error.byteLength)}）`;
    case "too-many":
      return `单条消息最多 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件（当前 ${error.count} 个）`;
  }
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
