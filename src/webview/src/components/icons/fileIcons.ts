// 文件类型图标解析：从随包分发的文件图标集（assets/fileicons）里按
// 「精确文件名 → 扩展名」两级映射取 URL；浅色主题优先 _light 变体。
// 纯函数 + 只读表，供 FileIcon 组件与测试直接消费。
const modules = import.meta.glob("../../../assets/fileicons/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const byName: ReadonlyMap<string, string> = new Map(
  Object.entries(modules).map(([path, url]) => [
    path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/, ""),
    url,
  ]),
);

/** 无扩展名/知名构建文件直接按文件名命中（小写）。 */
const EXACT_FILES: Record<string, string> = {
  dockerfile: "docker",
  makefile: "makefile",
  gnumakefile: "makefile",
  cmakecache: "makefile",
  "cmakelists.txt": "makefile",
  license: "license",
  licence: "license",
  readme: "readme",
  changelog: "changelog",
  "code-of-conduct": "readme",
  contributing: "readme",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  ".editorconfig": "editorconfig",
  ".env": "lock",
  ".npmrc": "npm",
  ".nvmrc": "npm",
  ".prettierrc": "prettier",
  ".eslintrc": "eslint",
  ".babelrc": "jsconfig",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "tsconfig.json": "tsconfig",
  "jsconfig.json": "jsconfig",
  "turbo.json": "json",
};

/** 扩展名 → 图标名（小写扩展名）。 */
const BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "react",
  json: "json",
  jsonc: "json",
  json5: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "sass",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  avi: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  pdf: "pdf",
  zip: "zip",
  rar: "zip",
  "7z": "zip",
  gz: "zip",
  tgz: "zip",
  py: "python",
  pyi: "python",
  pyw: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  scala: "scala",
  dart: "dart",
  sh: "console",
  bash: "console",
  zsh: "console",
  fish: "console",
  ps1: "powershell",
  psm1: "powershell",
  bat: "console",
  cmd: "console",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  graphql: "graphql",
  gql: "graphql",
  proto: "proto",
  prisma: "prisma",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  gradle: "gradle",
  lock: "lock",
  log: "log",
  sql: "database",
  db: "database",
  sqlite: "database",
  env: "lock",
  properties: "toml",
  ini: "toml",
  conf: "toml",
  cfg: "toml",
  txt: "text",
};

function lookup(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return byName.has(name) ? name : undefined;
}

function variantFor(name: string, light: boolean): string | undefined {
  if (light) {
    const lightVariant = lookup(`${name}_light`);
    if (lightVariant) return byName.get(lightVariant);
  }
  return byName.get(name);
}

/**
 * 解析文件路径（或裸文件名/扩展名）对应的图标资源 URL。
 * 返回 null 表示集合里没有可用的图标，调用方应回落到通用文件字形。
 */
export function resolveFileIcon(path: string, light = false): string | null {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  if (!base) return null;
  const lower = base.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf(".") + 1);

  const candidate =
    lookup(EXACT_FILES[lower]) ?? lookup(BY_EXTENSION[ext]) ?? (ext === lower ? lookup(lower) : undefined);
  const url = candidate ? variantFor(candidate, light) : undefined;
  return url ?? null;
}

/** 供诊断/测试：集合内是否存在某图标名。 */
export function hasFileIcon(name: string): boolean {
  return byName.has(name);
}
