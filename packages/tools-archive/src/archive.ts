// 归档核心：zip 组装（容器库）与口令加密（PBKDF2-SHA256 + AES-256-CBC）。
// 加密产物自带版本头（magic + salt + iv），解密端按头解析并校验填充，
// 口令错误以显式错误呈现，绝不产出静默损坏。
import { ZipFile } from "yazl";
import { cipher as forgeCipher, md as forgeMd, pkcs5, random as forgeRandom, util as forgeUtil } from "node-forge";

const MAGIC = Buffer.from("IHARCH1", "utf8");
const SALT_BYTES = 16;
const IV_BYTES = 16;
const KEY_BYTES = 32;
const DIGEST_BYTES = 32;
const PBKDF2_ITERATIONS = 200_000;

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

export function isEncryptedArchive(blob: Buffer): boolean {
  return blob.length > MAGIC.length && blob.subarray(0, MAGIC.length).equals(MAGIC);
}

function deriveKey(passphrase: string, saltBinary: string): string {
  return pkcs5.pbkdf2(passphrase, saltBinary, PBKDF2_ITERATIONS, KEY_BYTES, forgeMd.sha256.create());
}

/** SHA-256 over binary-string data, returned as a binary string. */
function sha256Binary(data: string): string {
  const digest = forgeMd.sha256.create();
  digest.update(data);
  return digest.digest().bytes();
}

/** Encrypts a payload with a passphrase-derived key (v1 header format).
 *  A plaintext digest rides INSIDE the ciphertext so a wrong passphrase is
 *  always detected deterministically (CBC padding alone is probabilistic). */
export function encryptArchive(payload: Buffer, passphrase: string): Buffer {
  if (!passphrase || passphrase.trim().length === 0) throw new Error("加密口令不能为空");
  const saltBinary = forgeRandom.getBytesSync(SALT_BYTES);
  const ivBinary = forgeRandom.getBytesSync(IV_BYTES);
  const key = deriveKey(passphrase, saltBinary);
  const encipher = forgeCipher.createCipher("AES-CBC", key);
  encipher.start({ iv: ivBinary });
  const payloadBinary = payload.toString("binary");
  encipher.update(forgeUtil.createBuffer(sha256Binary(payloadBinary) + payloadBinary));
  if (!encipher.finish()) throw new Error("归档加密失败");
  return Buffer.concat([
    MAGIC,
    Buffer.from(saltBinary, "binary"),
    Buffer.from(ivBinary, "binary"),
    Buffer.from(encipher.output.getBytes(), "binary"),
  ]);
}

/** Decrypts a v1-format archive; wrong passphrase or corrupt blob throws. */
export function decryptArchive(blob: Buffer, passphrase: string): Buffer {
  if (!isEncryptedArchive(blob)) throw new Error("不是加密归档");
  const header = MAGIC.length + SALT_BYTES + IV_BYTES;
  if (blob.length <= header) throw new Error("加密归档已损坏");
  const saltBinary = blob.subarray(MAGIC.length, MAGIC.length + SALT_BYTES).toString("binary");
  const ivBinary = blob.subarray(MAGIC.length + SALT_BYTES, header).toString("binary");
  const key = deriveKey(passphrase, saltBinary);
  const decipher = forgeCipher.createDecipher("AES-CBC", key);
  decipher.start({ iv: ivBinary });
  decipher.update(forgeUtil.createBuffer(blob.subarray(header).toString("binary")));
  const ok = decipher.finish();
  if (!ok) throw new Error("解密失败：口令错误或归档损坏");
  const plainBinary = decipher.output.getBytes();
  const expectedDigest = plainBinary.slice(0, DIGEST_BYTES);
  const payloadBinary = plainBinary.slice(DIGEST_BYTES);
  if (sha256Binary(payloadBinary) !== expectedDigest) {
    throw new Error("解密失败：口令错误或归档损坏");
  }
  return Buffer.from(payloadBinary, "binary");
}
