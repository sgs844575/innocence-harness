// 本仓库用到的 zip 写出面（该包未自带类型声明；按实际使用的 API 声明）。
declare module "yazl" {
  import { Readable } from "node:stream";

  export class ZipFile {
    addBuffer(buffer: Buffer, metadataPath: string, options?: { mtime?: Date }): void;
    addFile(realPath: string, metadataPath: string, options?: { mtime?: Date }): void;
    end(options?: { forceZip64Eocd?: boolean }): void;
    readonly outputStream: Readable;
  }
}
