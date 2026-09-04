const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  less: "less",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

export function languageForFilePath(filePath: string | undefined): string {
  const name = filePath?.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return EXTENSION_LANGUAGES[extension] ?? "text";
}

export interface PreparedFileContent {
  code: string;
  startLine?: number;
  note?: string;
  numbered: boolean;
}

/**
 * Read results use a `line number + tab` prefix. Remove that transport-only
 * prefix so the configured code renderer can own line-number visibility and
 * preserve the original starting line for paged reads.
 */
export function prepareFileContent(source: string, numbered: boolean): PreparedFileContent {
  if (!numbered) return { code: source, numbered: false };
  const lines = source.split(/\r?\n/);
  const first = /^(\d+)\t(.*)$/.exec(lines[0] ?? "");
  if (!first) return { code: source, numbered: false };

  const startLine = Number(first[1]);
  const codeLines: string[] = [];
  let index = 0;
  let expected = startLine;
  for (; index < lines.length; index += 1) {
    const match = /^(\d+)\t(.*)$/.exec(lines[index]!);
    if (!match || Number(match[1]) !== expected) break;
    codeLines.push(match[2]!);
    expected += 1;
  }

  const note = lines.slice(index).join("\n").trim();
  return {
    code: codeLines.join("\n"),
    startLine,
    ...(note ? { note } : {}),
    numbered: true,
  };
}

/** Create a fence longer than any backtick run in the file body. */
export function codeFence(source: string, language: string, startLine?: number): string {
  const longestRun = Math.max(0, ...(source.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  const meta = startLine !== undefined && startLine > 1 ? ` startLine=${startLine}` : "";
  const body = source.endsWith("\n") ? source : `${source}\n`;
  return `${fence}${language}${meta}\n${body}${fence}`;
}
