// 自定义 CA 校验：PEM 包解析、Chromium 结果判定、链式决策与 session 安装。
// 内嵌证书由 openssl 生成（CA 直签叶子，SAN=DNS:example.com，有效期至 2126 年）。
import crypto from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideCustomCaVerify,
  installCustomCaVerify,
  isChromiumVerifySuccess,
  parsePemBundle,
  verifyLeafAgainstBundle,
  type CertificateVerifySessionLike,
} from "./customCaVerify";

const CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDIzCCAgugAwIBAgIUcRwISjdmBYZJFfWc8k/XguIM5kQwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVSW5ub2NlbmNlVGVzdCBSb290IENBMCAXDTI2MDkwNDAy
NDUxMFoYDzIxMjYwODExMDI0NTEwWjAgMR4wHAYDVQQDDBVJbm5vY2VuY2VUZXN0
IFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCfqQpJ9+OG
pMZUnYMS/DOc0fZmsEEJRk+5EwVRC4JPa9DqXAjzw9jN0dztjNNQe9ecBxLz3XKD
X4CFgnHiFzrp5p7IX8V4lfg0E0xEQjAnbb6pHZOMLsrtF3fJbzcQfmRBA1okIqrb
qouw+EYQ4c+bPr6lmjyGB0HGFr9eTsxx1UqTm4UZp/GBDA2ZnfIwJu0Jxe8XHwh6
OPqyOa9e6U0qTYrYXW3OmkZ8cmv+uXXpCaOq865kZv+ENNJzRpVbAwnb/zTxfTYl
TzEVa+j6YME5UF2w1/OvGEm3RFaqBWZQTWYTGr+o+nqX9hpzRzujf1kDz5Z+7VHI
LL8fuhXTMT6jAgMBAAGjUzBRMB0GA1UdDgQWBBQkC3aIPW3EqBwQWXMB6HRPKkj1
YTAfBgNVHSMEGDAWgBQkC3aIPW3EqBwQWXMB6HRPKkj1YTAPBgNVHRMBAf8EBTAD
AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBLSU00aFN8fKBsq5G3jzp4d0mHwa9NoA3E
TfMjEmJ+u4NRlGSbf9TjRFHvPlqjJwzA7hrucJrmCo8yN3R90pl++c4mGMYdAYBq
o6j/G/6eqy8rEXX1GU0ziFwxSctIxXfiq1YS0sH5RPmmRJYSjZMGhB2QKAl3g2T6
h/BootISFK2WwT6hiC8plAfHpZBd+3C9mpr35uc+Ar0bWhiez/mqBw1FdQ9PH1CQ
DGGTJMjelPctNIkw1Bg05pIcxhM0O4bUr9i9WohNaxuv1sLKqoETPdEE+IWiJD3V
5AKzD2B76QNOpYr0o/mr6pquYBburmNjY51zqW2WvQpm4vP8S7dS
-----END CERTIFICATE-----`;

const LEAF_PEM = `-----BEGIN CERTIFICATE-----
MIIDMTCCAhmgAwIBAgIUXGemd8vo8Q+ePzbJQ9THJhIXGVMwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVSW5ub2NlbmNlVGVzdCBSb290IENBMCAXDTI2MDkwNDAy
NDUxMFoYDzIxMjYwODExMDI0NTEwWjAWMRQwEgYDVQQDDAtleGFtcGxlLmNvbTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALsZSMWM/GQ1OfYLIiwwzJWw
9Qd8fhSDxnDzj1xNR58/iRYXmg2emboO2eWwRcEq36zV+aRyKPKYe7tE14c9/acL
jDl12vkWmugf2nKfbHDiyM55IWB/1Z4WfOn0f0Vj8pm5mkJFl5ZIaN2t2vMcTC7R
t2MaVohbBU5Ja3+wFsBkKZlS9C1YgJ2Vblio06qyhqDJJGQcF9dOtM+4eqfUjx5y
pOrS4HAoIdQTjLhSjIOOPblkXG5D6T8t/gO0xOuXxZfS43cq9j46Qmzdm51lk8wY
hxP2BD3bmxO6xUZpYASO4y8ZgkH4zXy1a5hRiT8EqQ7wovImf2c/Vj2ePsgpdFcC
AwEAAaNrMGkwJwYDVR0RBCAwHoILZXhhbXBsZS5jb22CD3d3dy5leGFtcGxlLmNv
bTAdBgNVHQ4EFgQURa3c1MBd0LNLWs1gRxkt7EUWctMwHwYDVR0jBBgwFoAUJAt2
iD1txKgcEFlzAeh0TypI9WEwDQYJKoZIhvcNAQELBQADggEBAJbKi3OHFu2upiCq
Wzae4Hkkun+3af197CtTJ1qKaZNoMPQRMf6AjnUOM91iiJfwcfuufdGlInRkdduC
NcDUrGh++4L0+aKFMAnIMjSEP5rNwbnIznWHxRCnz0GQKsTOwV0yfVtJM8jDkTLu
L52azGN3dsyJqwGd8XShbS+IGGrz4uALqM3cNSSN/wYkIA1Y2E4ms+tZExobPFAy
MTNWc07LIsBqcYFoWxyjxS8IMd1qFWPtbcSysVmQMZLLKPJf3V7w24Grx/q2HkaP
PyHjFbB6bznB+eGQwvVl2nZ9GYWfDZC+L+uook9VUjlFSMe1+hHOnATPLmx9YORV
sYj/REc=
-----END CERTIFICATE-----`;

const OTHER_PEM = `-----BEGIN CERTIFICATE-----
MIIDFTCCAf2gAwIBAgIUVIdfEm2pto3G+VxWPBNqcfE4oj4wDQYJKoZIhvcNAQEL
BQAwGTEXMBUGA1UEAwwOVW5yZWxhdGVkIFJvb3QwIBcNMjYwOTA0MDI0NTEwWhgP
MjEyNjA4MTEwMjQ1MTBaMBkxFzAVBgNVBAMMDlVucmVsYXRlZCBSb290MIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0zmS9aQ4vbkyTmQQq08h1M3tER6v
2F9U5rJ/p4JM+tjWszL5uMZl9sU6FWL9rSICp/QVXOa+Vh+6LkKHj0sZOWrfw0TH
KlA7R77nrOf2TsLR18g+nS/SXeintjT5Y7MB13836OghUf5ke3TacMuAPVx2s3bN
GSggowtwpuien3FwrTCPAQ1fNhr/2hqqFBIyghhnimVD8rD/HcE4WnQkXF3Ad6Sn
MFR4V06UWjjmP9youbrWrcVm8rMQBPF4ZypkJnAB9hmyFpb175iqoQ3pblBDQoNp
aRcyE7sc5qtMH3K9mxmxGLXDkuA95H2QcaQsNWhskP9zmQLAWv9kRbpKrwIDAQAB
o1MwUTAdBgNVHQ4EFgQUOtX/QFT4s/zPlLbIr2dFn+pTfOYwHwYDVR0jBBgwFoAU
OtX/QFT4s/zPlLbIr2dFn+pTfOYwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0B
AQsFAAOCAQEAubhQHGSFscfQ6yT9gtkKSd2x6R1gSGCrtJhfoK3ArQsP7bBr2Qo/
5KNxcoxlB5IWJIhqUWaMonApRWAdec1hJd04NmIZhRGYnr4QrOAYiCcXcPDwD7AD
c/wKRJndeLtGwlF3ZOTceiIhzBlNQ3XIjDD9FoGqyrhFzuE3/RBO90kjJmd7eJuG
Bg6ouZNmGyc8NvsxxcnT+ns9rCLYovoCsRlQYhT+JgO03HBgFPzIFh20IHn0zTSw
cDhUodnFzYqZmXZuTT/DYy8fDdkpn9jDFMHV6eVZnHphrs/JOczN0jHgqu0QItBR
qantOUBS7IR+bhxBuMPUOfzaHKEkBxzgJQ==
-----END CERTIFICATE-----`;

const ca = new crypto.X509Certificate(CA_PEM);
const leaf = new crypto.X509Certificate(LEAF_PEM);
const other = new crypto.X509Certificate(OTHER_PEM);

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("parsePemBundle", () => {
  it("解析多张证书并跳过自由文本与坏块", () => {
    const bundle = parsePemBundle(`header text\n${CA_PEM}\n${LEAF_PEM}\n-----BEGIN CERTIFICATE-----\nbroken!!\n-----END CERTIFICATE-----`);
    expect(bundle).toHaveLength(2);
    expect(bundle[0]!.fingerprint256).toBe(ca.fingerprint256);
    expect(bundle[1]!.fingerprint256).toBe(leaf.fingerprint256);
  });

  it("空文本/无证书块 → 空数组", () => {
    expect(parsePemBundle("")).toEqual([]);
    expect(parsePemBundle("just some notes")).toEqual([]);
  });
});

describe("isChromiumVerifySuccess", () => {
  it("数值 0 与字符串 OK 视为成功", () => {
    expect(isChromiumVerifySuccess(0)).toBe(true);
    expect(isChromiumVerifySuccess("OK")).toBe(true);
    expect(isChromiumVerifySuccess("ok")).toBe(true);
  });

  it("其他值视为失败", () => {
    expect(isChromiumVerifySuccess(-202)).toBe(false);
    expect(isChromiumVerifySuccess("ERR_CERT_AUTHORITY_INVALID")).toBe(false);
    expect(isChromiumVerifySuccess(undefined)).toBe(false);
  });
});

describe("verifyLeafAgainstBundle", () => {
  it("CA 直签 + 主机名匹配 → 通过", () => {
    expect(verifyLeafAgainstBundle(leaf, "example.com", [ca])).toBe(true);
    expect(verifyLeafAgainstBundle(leaf, "www.example.com", [ca])).toBe(true);
  });

  it("主机名不匹配 → 拒绝", () => {
    expect(verifyLeafAgainstBundle(leaf, "other.com", [ca])).toBe(false);
  });

  it("包内根未签发叶子 → 拒绝", () => {
    expect(verifyLeafAgainstBundle(leaf, "example.com", [other])).toBe(false);
    expect(verifyLeafAgainstBundle(leaf, "example.com", [])).toBe(false);
  });

  it("有效期窗口外 → 拒绝（注入时钟与假证书）", () => {
    const fakeLeaf = {
      validFrom: "Jan  1 00:00:00 2020 GMT",
      validTo: "Jan  2 00:00:00 2030 GMT",
      verify: () => true,
    } as unknown as crypto.X509Certificate;
    const identity = vi.fn();
    const ca2 = { publicKey: {} } as unknown as crypto.X509Certificate;
    const inWindow = Date.parse("2025-06-01T00:00:00Z");
    expect(verifyLeafAgainstBundle(fakeLeaf, "h", [ca2], { now: () => inWindow, checkServerIdentity: identity })).toBe(true);
    expect(verifyLeafAgainstBundle(fakeLeaf, "h", [ca2], { now: () => Date.parse("2019-01-01"), checkServerIdentity: identity })).toBe(false);
    expect(verifyLeafAgainstBundle(fakeLeaf, "h", [ca2], { now: () => Date.parse("2031-01-01"), checkServerIdentity: identity })).toBe(false);
  });

  it("verify 抛错/返回 false、主机名检查抛错 → 拒绝", () => {
    const throwingLeaf = {
      validFrom: "Jan  1 00:00:00 2020 GMT",
      validTo: "Jan  1 00:00:00 2040 GMT",
      verify: () => { throw new Error("bad key"); },
    } as unknown as crypto.X509Certificate;
    const ca2 = { publicKey: {} } as unknown as crypto.X509Certificate;
    expect(verifyLeafAgainstBundle(throwingLeaf, "h", [ca2], { now: () => Date.parse("2025-01-01") })).toBe(false);
    const unsignedLeaf = { ...throwingLeaf, verify: () => false } as unknown as crypto.X509Certificate;
    expect(verifyLeafAgainstBundle(unsignedLeaf, "h", [ca2], { now: () => Date.parse("2025-01-01") })).toBe(false);
    const goodLeaf = { ...throwingLeaf, verify: () => true } as unknown as crypto.X509Certificate;
    expect(
      verifyLeafAgainstBundle(goodLeaf, "h", [ca2], {
        now: () => Date.parse("2025-01-01"),
        checkServerIdentity: () => { throw new Error("hostname mismatch"); },
      }),
    ).toBe(false);
  });
});

describe("decideCustomCaVerify", () => {
  it("Chromium 已有效 → 0（不解析证书）", () => {
    expect(
      decideCustomCaVerify(
        { hostname: "anything", verificationResult: "OK", errorCode: -202, certificateData: new Uint8Array() },
        [],
      ),
    ).toBe(0);
  });

  it("Chromium 失败但自定义根包校验通过 → 0", () => {
    expect(
      decideCustomCaVerify(
        { hostname: "example.com", verificationResult: -202, errorCode: -202, certificateData: leaf.raw },
        [ca],
      ),
    ).toBe(0);
  });

  it("校验失败 → 回传 Chromium 错误码（缺省 -2）", () => {
    expect(
      decideCustomCaVerify(
        { hostname: "wrong.com", verificationResult: -202, errorCode: -202, certificateData: leaf.raw },
        [ca],
      ),
    ).toBe(-202);
    expect(
      decideCustomCaVerify(
        { hostname: "example.com", verificationResult: -202, certificateData: leaf.raw },
        [other],
      ),
    ).toBe(-2);
    expect(
      decideCustomCaVerify(
        { hostname: "example.com", verificationResult: -202, errorCode: -202, certificateData: new Uint8Array([1, 2, 3]) },
        [ca],
      ),
    ).toBe(-202);
  });
});

describe("installCustomCaVerify", () => {
  function certFile(content: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "caverify-"));
    tempDirs.push(dir);
    const file = path.join(dir, "bundle.pem");
    writeFileSync(file, content, "utf8");
    return file;
  }

  it("文件缺失或无有效证书 → false，不安装", () => {
    const session: CertificateVerifySessionLike = { setCertificateVerifyProc: vi.fn() };
    expect(installCustomCaVerify(session, path.join(os.tmpdir(), "no-such-ca.pem"))).toBe(false);
    expect(installCustomCaVerify(session, certFile("no certs here"))).toBe(false);
    expect(session.setCertificateVerifyProc).not.toHaveBeenCalled();
  });

  it("有效 PEM → 安装并按请求决策", () => {
    let proc: Parameters<CertificateVerifySessionLike["setCertificateVerifyProc"]>[0] | undefined;
    const session: CertificateVerifySessionLike = {
      setCertificateVerifyProc: (p) => { proc = p; },
    };
    expect(installCustomCaVerify(session, certFile(CA_PEM))).toBe(true);
    expect(proc).toBeDefined();

    const accept = vi.fn();
    proc!(
      { hostname: "example.com", certificate: { data: leaf.raw }, verificationResult: -202, errorCode: -202 },
      accept,
    );
    expect(accept).toHaveBeenCalledWith(0);

    const reject = vi.fn();
    proc!(
      { hostname: "wrong.com", certificate: { data: leaf.raw }, verificationResult: -202, errorCode: -202 },
      reject,
    );
    expect(reject).toHaveBeenCalledWith(-202);
  });
});
