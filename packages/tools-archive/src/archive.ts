// 归档核心：zip 组装（容器库）。
import { ZipFile } from "yazl";

export interface ArchiveEntry {
  /** 归档内的路径（POSIX 形态）。 */
  name: string;
  data: Buffer;
}

/** Collects the container stream into one buffer. */
function streamToBuffer(stream: import("node:stream").Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** Packs entries into a zip container buffer. */
export async function createZipArchive(entries: readonly ArchiveEntry[]): Promise<Buffer> {
  if (entries.length === 0) throw new Error("归档条目为空");
  const zipfile = new ZipFile();
  for (const entry of entries) {
    zipfile.addBuffer(entry.data, entry.name);
  }
  zipfile.end();
  return streamToBuffer(zipfile.outputStream);
}
