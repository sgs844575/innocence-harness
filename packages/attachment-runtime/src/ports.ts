// 附件编排端口与导入产物类型：attachment-runtime 定义契约，attachment-node
// 提供 Node 实现（CAS 存储 + 解析器）。宿主（主进程）持有实现并驱动导入。
import type { ContentRef } from "@innocenceharness/harness-session";

/** CAS 写入结果（key 为 `sha256:<hex>`）。 */
export interface StoredObject {
  key: string;
  byteLength: number;
  /** 同内容已存在时为 true（去重命中，未重写）。 */
  deduplicated: boolean;
}

/** 内容存储端口：原子写入 + 按键读取（字节与元信息）。 */
export interface ContentStore {
  /** mediaType 随对象入索引（同内容去重时首个写入者的类型保留）。 */
  put(bytes: Uint8Array, mediaType?: string): Promise<StoredObject>;
  has(key: string): Promise<boolean>;
  /** 读取对象字节；缺失抛错（调用方转结构化错误，永不静默）。 */
  get(key: string): Promise<Uint8Array>;
}

/** 解析后的附件导入产物：宿主把它转成 canonical AttachmentPart 与 UI DTO。 */
export interface ImportedAttachment {
  /** 展示名（导入时用户提供或截取的文件名）。 */
  name: string;
  /** 原始导入对象的引用。 */
  source: ContentRef;
  /** 模型可见表示（文本抽取 / 规范化图像；PDF 文本表示带页码）。 */
  representations: Array<{
    kind: "text" | "image";
    content: ContentRef;
    page?: number;
  }>;
  /** 预览信息：文本类给截断摘录；图像给（可选）缩略图引用。 */
  preview:
    | { kind: "text"; excerpt: string }
    | { kind: "image"; thumbnail?: ContentRef; width?: number; height?: number }
    | { kind: "binary" };
  /** 非致命提示（如「扫描 PDF 无可抽取文本」「GIF 按首帧处理」）。 */
  warnings: string[];
}

/** 解析器输入：原始字节 + 展示名（解析器不做大小校验，导入管线前置校验）。 */
export interface ParserInput {
  name: string;
  bytes: Uint8Array;
}

/** 单个解析器：识别并产出表示；不识别返回 null（管线继续下一个解析器）。 */
export interface AttachmentParser {
  id: string;
  version: string;
  parse(input: ParserInput, store: ContentStore): Promise<ImportedAttachment | null>;
}
