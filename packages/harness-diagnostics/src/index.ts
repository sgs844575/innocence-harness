import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface DiagnosticNote {
  code: number;
  line: number;
  column: number;
  message: string;
}

function flatten(message: string | ts.DiagnosticMessageChain): string {
  return ts.flattenDiagnosticMessageText(message, " ").replace(/\s+/g, " ").trim();
}

/**
 * Diagnoses one focused TS/JS file using the workspace tsconfig when present.
 * This is an in-process compiler API adapter: no external language-server
 * binary, watcher or long-lived process is required. Non-TS files yield [].
 */
export function diagnoseFocusedFile(workspaceRoot: string, relativePath: string): DiagnosticNote[] {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!/\.(cts|mts|ts|tsx|js|jsx)$/i.test(normalized)) return [];
  const fileName = path.resolve(workspaceRoot, normalized);
  if (!fileName.startsWith(path.resolve(workspaceRoot) + path.sep) && fileName !== path.resolve(workspaceRoot)) return [];
  if (!fs.existsSync(fileName)) return [];
  const configPath = ts.findConfigFile(path.dirname(fileName), ts.sys.fileExists, "tsconfig.json");
  const parsed = configPath
    ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath))
    : { options: { allowJs: true, checkJs: true, noEmit: true }, fileNames: [fileName] };
  const rootNames = parsed.fileNames.includes(fileName) ? parsed.fileNames : [...parsed.fileNames, fileName];
  const program = ts.createProgram({ rootNames, options: parsed.options });
  const source = program.getSourceFile(fileName);
  if (!source) return [];
  return ts.getPreEmitDiagnostics(program, source).map((d) => {
    const pos = d.start === undefined ? { line: 0, character: 0 } : source.getLineAndCharacterOfPosition(d.start);
    return { code: d.code, line: pos.line + 1, column: pos.character + 1, message: flatten(d.messageText) };
  });
}

export function diagnosticFingerprint(note: DiagnosticNote): string {
  return `${note.code}:${note.line}:${note.column}:${note.message}`;
}
