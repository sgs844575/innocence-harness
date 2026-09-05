// 附件编排面（宿主无关）：限制常量、CAS/解析器端口、GC 规划。Node 实现见
// attachment-node；会话内校验插件见 plugin-attachments。
export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_PDF_PAGES,
  MAX_IMAGE_EDGE,
  checkImportSize,
  checkMessageAttachmentCount,
  describeAttachmentLimitError,
  formatBytes,
  type AttachmentLimitError,
} from "./limits";
export type {
  StoredObject,
  ContentStore,
  ImportedAttachment,
  ParserInput,
  AttachmentParser,
} from "./ports";
export { GC_TOMBSTONE_MS, planAttachmentGc, type Tombstones, type GcPlan } from "./gc";
