// Custom `innocenceharness://` protocol (`protocol.handle` + a dedicated app
// scheme) so the renderer is served from a stable, secure origin and the CSP
// can lock script-src to 'self'. The sibling `innocenceharness-plugin://` protocol
// serves plugin assets (UI slots, scripts) from the dual plugin roots.
import { protocol } from "electron";
import fs from "node:fs";
import path from "node:path";

export const APP_SCHEME = "innocenceharness";
export const PLUGIN_SCHEME = "innocenceharness-plugin";
export const CONTENT_SCHEME = "innocenceharness-content";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export function registerAppScheme(): void {
  // Must be called before app is ready.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

export function handleAppScheme(): void {
  const rendererRoot = path.resolve(__dirname, "../renderer");
  protocol.handle(APP_SCHEME, (request) => {
    let resolved: string;
    try {
      const url = new URL(request.url);
      if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== "app") {
        return new Response("Forbidden", { status: 403 });
      }
      // innocenceharness://app/<path> -> .vite/renderer/<path>
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const target = rel === "" || rel.endsWith("/") ? path.join(rel, "index.html") : rel;
      resolved = path.normalize(path.join(rendererRoot, target));
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
    if (resolved !== rendererRoot && !resolved.startsWith(rendererRoot + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      // Read through fs, NOT net.fetch(pathToFileURL(...)): fs resolves paths
      // inside app.asar transparently, while the network-service file loader
      // does not (fails with ERR_FILE_NOT_FOUND for asar member paths).
      const body = fs.readFileSync(resolved);
      const type =
        MIME[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
      return new Response(body, { headers: { "content-type": type } });
    } catch (err) {
      return new Response(`Not found: ${request.url} -> ${resolved}\n${String(err)}`, {
        status: 404,
      });
    }
  });
}

export function appIndexUrl(): string {
  return `${APP_SCHEME}://app/index.html`;
}

// Content types for plugin assets: module scripts, styles, and data; anything
// else ships as an opaque byte stream.
const PLUGIN_MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** Plugin roots in probe order: the user root first shadows the builtin root. */
export interface PluginSchemeRoots {
  /** User plugin root (`~/.innocence/plugins`); wins over the builtin root. */
  userRoot: string;
  /** Built-in plugin root (staging `plugins/` or packaged `resources/plugins`). */
  builtinRoot: string;
}

export function registerPluginScheme(): void {
  // Must be called before app is ready. No `stream` privilege: plugin assets
  // are small discrete files, not streamed media. `corsEnabled` is required:
  // every consumer page (app scheme or dev server) is cross-origin to the
  // plugin scheme, and Chromium blocks cross-origin fetches of schemes that
  // do not participate in CORS ("CorsDisabledScheme") before any handler
  // response is considered.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLUGIN_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Whether the id is a plain single directory segment below a root. Mirrors
 *  the loader resolver's plain-specifier rule (dot prefix, separators, and
 *  drive letters rejected) so a joined path cannot escape through the id. */
function isPlainPluginId(id: string): boolean {
  return (
    id !== "" &&
    !id.startsWith(".") &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !/^[a-zA-Z]:/.test(id)
  );
}

/** Whether the normalized candidate path stays inside the given root. */
function isInsideRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function handlePluginScheme(options: PluginSchemeRoots): void {
  const roots = [path.resolve(options.userRoot), path.resolve(options.builtinRoot)];
  protocol.handle(PLUGIN_SCHEME, (request) => {
    // innocenceharness-plugin://<pluginId>/<file...>: host carries the plugin id,
    // pathname the file relative to the plugin directory.
    let pluginId = "";
    let rel = "";
    try {
      const url = new URL(request.url);
      pluginId = decodeURIComponent(url.hostname);
      rel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      // Unparseable URL or malformed percent-encoding: refuse, never guess.
      return pluginResponse("Forbidden", 403);
    }
    if (!isPlainPluginId(pluginId)) {
      return pluginResponse("Forbidden", 403);
    }
    for (const root of roots) {
      const resolved = path.normalize(path.join(root, pluginId, rel));
      if (!isInsideRoot(resolved, root)) {
        return pluginResponse("Forbidden", 403);
      }
      try {
        // Read through fs, NOT net.fetch(pathToFileURL(...)): fs resolves
        // paths inside app.asar transparently (same rationale as the app
        // scheme). A miss in this root falls through to the next root.
        const body = fs.readFileSync(resolved);
        const type =
          PLUGIN_MIME[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
        return new Response(body, { headers: { ...PLUGIN_CORS, "content-type": type } });
      } catch {
        // Not readable in this root: try the next one.
      }
    }
    return pluginResponse(`Not found: ${request.url}\n`, 404);
  });
}

/** Plugin pages/assets load cross-origin (renderer origin is the app scheme
 *  or the dev server, never the plugin scheme itself), so every response
 *  opts in to credential-free cross-origin reads. */
const PLUGIN_CORS = { "access-control-allow-origin": "*" } as const;

function pluginResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: PLUGIN_CORS });
}

// ---- 附件内容直显（规格 §10.8：受控同源内容协议，不用巨型 data URL）-------
// innocenceharness-content://obj/sha256:<hex> → CAS 对象字节；MIME 取导入时
// 魔数嗅探写入 index 的元数据。仅 img-src 消费（CSP 白名单单独放开）。

/** 内容对象读取面（附件 CAS 的同步子集；scheme 处理器不能 await IO 之外
 *  的编排）。 */
export interface ContentSchemeStore {
  get(key: string): Promise<Uint8Array>;
  entries(): Promise<Map<string, { mediaType: string; byteLength: number }>>;
}

export function registerContentScheme(): void {
  // Must be called before app is ready. corsEnabled: consumed cross-origin by
  // the renderer origin (app scheme / dev server).
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CONTENT_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

const CONTENT_KEY_RE = /^sha256:[0-9a-f]{64}$/;

export function handleContentScheme(store: ContentSchemeStore): void {
  protocol.handle(CONTENT_SCHEME, async (request) => {
    let key = "";
    try {
      const url = new URL(request.url);
      if (url.hostname !== "obj") return contentResponse("Forbidden", 403);
      key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      return contentResponse("Forbidden", 403);
    }
    if (!CONTENT_KEY_RE.test(key)) return contentResponse("Forbidden", 403);
    try {
      const [bytes, entries] = await Promise.all([store.get(key), store.entries()]);
      // 拷贝出精确尺寸 ArrayBuffer（Electron Response 的 BodyInit 口径）。
      const body = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return new Response(body, {
        headers: {
          ...PLUGIN_CORS,
          "content-type": entries.get(key)?.mediaType ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return contentResponse(`Not found: ${key}`, 404);
    }
  });
}

function contentResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: PLUGIN_CORS });
}
