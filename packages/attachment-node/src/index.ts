// attachment-node：FS CAS、魔数/文本嗅探、图像规范化、PDF 抽取与导入管线。
export { FsContentStore, type ContentIndexEntry } from "./cas-store";
export { sniffMedia, decodeText, type SniffKind, type SniffResult } from "./sniff";
export { normalizeImage, estimateImageTokens, type NormalizedImage } from "./images";
export { extractPdfText, type PdfTextExtract } from "./pdf";
export { importAttachment, AttachmentImportError, PARSERS } from "./import";
