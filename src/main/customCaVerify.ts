// 自定义 CA 的渲染层证书校验：Chromium 默认结果已有效时直接放行；否则用
// 用户提供的 PEM 根证书包做兜底校验（有效期窗口 → 叶子由包内根直签 → 主
// 机名匹配），全部通过才放行，否则回传 Chromium 原错误码。模块本体无
// Electron——session 以最小接口注入，校验面全部走 Node crypto/tls。
import crypto from "node:crypto";
import fs from "node:fs";
import tls, { type PeerCertificate } from "node:tls";

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g;

/** 解析 PEM 证书包（可含多张证书与自由文本）；单块损坏跳过，不污染整包。 */
export function parsePemBundle(text: string): crypto.X509Certificate[] {
  const certs: crypto.X509Certificate[] = [];
  for (const match of text.matchAll(PEM_BLOCK)) {
    try {
      certs.push(new crypto.X509Certificate(match[0]));
    } catch {
      // 忽略无法解析的块。
    }
  }
  return certs;
}

/** Chromium 校验结果的成功判定（数值 0 或字符串 "OK" 视为已有效）。 */
export function isChromiumVerifySuccess(verificationResult: unknown): boolean {
  if (typeof verificationResult === "number") return verificationResult === 0;
  if (typeof verificationResult === "string") return verificationResult.toUpperCase() === "OK";
  return false;
}

/** tls.checkServerIdentity 期望的 PeerCertificate 形状（本模块只需 SAN 与 subject）。 */
export interface PeerCertificateShape {
  subjectaltname?: string;
  subject: Record<string, string>;
}

/** X509Certificate.subject 是 RFC2253 风格文本（逗号或换行分隔）——提取为键值表。 */
function parseSubject(subject: unknown): Record<string, string> {
  if (typeof subject !== "string") return {};
  const out: Record<string, string> = {};
  for (const match of subject.matchAll(/([A-Za-z][A-Za-z0-9]*)=([^,\n]*)/g)) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

/** 从 X509Certificate 构造 checkServerIdentity 的入参形状。 */
export function toPeerCertificateShape(cert: crypto.X509Certificate): PeerCertificateShape {
  return {
    ...(typeof cert.subjectAltName === "string" ? { subjectaltname: cert.subjectAltName } : {}),
    subject: parseSubject(cert.subject),
  };
}

export interface CustomCaVerifyDeps {
  /** 主机名匹配（缺省 tls.checkServerIdentity）；返回 Error 或抛错 = 不匹配。 */
  checkServerIdentity?: (hostname: string, cert: PeerCertificateShape) => unknown;
  now?: () => number;
}

/** 叶子证书对根证书包的链式校验：有效期 → 包内根直签 → 主机名。 */
export function verifyLeafAgainstBundle(
  leaf: crypto.X509Certificate,
  hostname: string,
  bundle: readonly crypto.X509Certificate[],
  deps: CustomCaVerifyDeps = {},
): boolean {
  const now = (deps.now ?? Date.now)();
  if (now < Date.parse(leaf.validFrom) || now > Date.parse(leaf.validTo)) return false;
  const signed = bundle.some((ca) => {
    try {
      return leaf.verify(ca.publicKey);
    } catch {
      return false;
    }
  });
  if (!signed) return false;
  try {
    // Node 的 checkServerIdentity 不匹配时返回 Error 对象（不抛异常）；注入
    // 的自定义实现两种风格都可能。PeerCertificateShape 是 tls.PeerCertificate
    // 的子集——运行期只读 subjectaltname 与 subject.CN。
    const check =
      deps.checkServerIdentity ??
      ((hostname: string, cert: PeerCertificateShape) =>
        tls.checkServerIdentity(hostname, cert as unknown as PeerCertificate));
    const result = check(hostname, toPeerCertificateShape(leaf));
    if (result instanceof Error) return false;
  } catch {
    return false;
  }
  return true;
}

/** setCertificateVerifyProc 请求的最小形状。 */
export interface CertificateVerifyRequestLike {
  hostname: string;
  /** Chromium 校验结果（数值码或字符串）。 */
  verificationResult: unknown;
  /** Chromium 网络错误码（拒绝时回传）。 */
  errorCode?: number;
  /** 叶子证书数据（Electron 类型为 PEM 字符串；DER 字节同样接受）。 */
  certificateData: string | Uint8Array;
}

/**
 * 单请求决策：Chromium 已有效 → 0（放行）；否则按自定义根包兜底，全部检
 * 查通过 → 0，任一失败 → 回传 Chromium 错误码（缺省 -2）。
 */
export function decideCustomCaVerify(
  request: CertificateVerifyRequestLike,
  bundle: readonly crypto.X509Certificate[],
  deps: CustomCaVerifyDeps = {},
): number {
  if (isChromiumVerifySuccess(request.verificationResult)) return 0;
  const reject = typeof request.errorCode === "number" ? request.errorCode : -2;
  let leaf: crypto.X509Certificate;
  try {
    leaf = new crypto.X509Certificate(Buffer.from(request.certificateData));
  } catch {
    return reject;
  }
  return verifyLeafAgainstBundle(leaf, request.hostname, bundle, deps) ? 0 : reject;
}

/** Electron session 的最小接口（注入以保持本模块 Electron-free）。 */
export interface CertificateVerifySessionLike {
  setCertificateVerifyProc(
    proc: (
      request: {
        hostname: string;
        certificate: { data: string | Uint8Array };
        verificationResult: unknown;
        errorCode?: number;
      },
      callback: (result: number) => void,
    ) => void,
  ): void;
}

/**
 * 安装自定义 CA 校验：PEM 文件可读且至少解析出一张证书时安装并返回 true；
 * 否则返回 false（保留 Chromium 默认校验链）。
 */
export function installCustomCaVerify(session: CertificateVerifySessionLike, certFile: string): boolean {
  let bundle: crypto.X509Certificate[];
  try {
    bundle = parsePemBundle(fs.readFileSync(certFile, "utf8"));
  } catch {
    return false;
  }
  if (bundle.length === 0) return false;
  session.setCertificateVerifyProc((request, callback) => {
    callback(
      decideCustomCaVerify(
        {
          hostname: request.hostname,
          verificationResult: request.verificationResult,
          errorCode: request.errorCode,
          certificateData: request.certificate?.data ?? "",
        },
        bundle,
      ),
    );
  });
  return true;
}
