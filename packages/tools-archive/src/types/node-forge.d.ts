// 本仓库用到的对称加密与口令派生面（该包未自带类型声明；二进制统一以
// binary string 形态进出，Buffer 转换在封装层完成）。
declare module "node-forge" {
  export interface MessageDigest {
    update(data: unknown): MessageDigest;
    digest(): { toHex(): string; bytes(): string };
  }

  export interface Cipher {
    start(options?: { iv?: string }): void;
    update(buffer: { bytes(): string }): void;
    finish(): boolean;
    readonly output: { bytes(): string; getBytes(): string };
  }

  export interface Decipher {
    start(options?: { iv?: string }): void;
    update(buffer: { bytes(): string }): void;
    finish(): boolean;
    readonly output: { bytes(): string; getBytes(): string };
  }

  export const md: {
    sha256: { create(): MessageDigest };
  };

  export const random: {
    getBytesSync(byteCount: number): string;
  };

  export const pkcs5: {
    pbkdf2(password: string, salt: string, iterations: number, keySize: number, md?: MessageDigest): string;
  };

  export const cipher: {
    createCipher(algorithm: "AES-CBC", key: string): Cipher;
    createDecipher(algorithm: "AES-CBC", key: string): Decipher;
  };

  export const util: {
    createBuffer(input?: string | number[] | ArrayBuffer | ArrayBufferView): { bytes(): string };
  };
}
