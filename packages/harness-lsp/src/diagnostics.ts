// 中性诊断模型与 file URI 换算：LSP publishDiagnostics 载荷投影为
// {path, line, column, severity, code?, message, source?}（1 基行列，
// 与 harness-diagnostics 的注记口径一致）。
import { fileURLToPath, pathToFileURL } from "node:url";

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface DiagnosticNote {
  /** 工作区相对或绝对路径（由 manager 的换算决定，与开文件口径一致）。 */
  path: string;
  /** 1 基行。 */
  line: number;
  /** 1 基列。 */
  column: number;
  severity: DiagnosticSeverity;
  /** 服务器自定义代码（数字或字符串，如规则 id）。 */
  code?: number | string;
  message: string;
  /** 服务器自报来源（如诊断器名）。 */
  source?: string;
}

/** LSP 数值严重度 → 中性档；未知/缺失按 error 处理（fail 显式）。 */
export function mapSeverity(raw: unknown): DiagnosticSeverity {
  if (raw === 2) return "warning";
  if (raw === 3) return "info";
  if (raw === 4) return "hint";
  return "error";
}

interface RawDiagnostic {
  range?: { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
  severity?: unknown;
  code?: unknown;
  message?: unknown;
  source?: unknown;
}

function positiveInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) + 1 : 1;
}

/** 投影一条 publishDiagnostics 的 diagnostics 数组；坏形状逐条剔除（不抛）。 */
export function projectDiagnostics(uri: string, raw: unknown): DiagnosticNote[] {
  if (!Array.isArray(raw)) return [];
  const path = uriToPath(uri);
  const notes: DiagnosticNote[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const diagnostic = entry as RawDiagnostic;
    if (typeof diagnostic.message !== "string" || diagnostic.message === "") continue;
    notes.push({
      path,
      line: positiveInt(diagnostic.range?.start?.line),
      column: positiveInt(diagnostic.range?.start?.character),
      severity: mapSeverity(diagnostic.severity),
      ...(diagnostic.code !== undefined && (typeof diagnostic.code === "number" || typeof diagnostic.code === "string")
        ? { code: diagnostic.code }
        : {}),
      message: diagnostic.message,
      ...(typeof diagnostic.source === "string" && diagnostic.source !== "" ? { source: diagnostic.source } : {}),
    });
  }
  return notes;
}

/** file URI → 平台路径（node:url 标准换算，含 Windows 盘符/反斜杠归一）；
 *  非 file 协议原样返回（untitled 等按原串处理）。 */
export function uriToPath(uri: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

/** 平台路径 → file URI（node:url 标准换算，didOpen 载荷口径）。 */
export function pathToUri(path: string): string {
  try {
    return pathToFileURL(path).toString();
  } catch {
    return path;
  }
}

/** 去重指纹：语义相同的诊断（同码同行列同文）判等。 */
export function diagnosticFingerprint(note: DiagnosticNote): string {
  return `${note.severity}:${note.code ?? ""}:${note.line}:${note.column}:${note.message}`;
}
