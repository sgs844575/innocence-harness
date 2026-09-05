import path from "node:path";
import type { HookFunction } from "@electron/packager";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { pruneNodePtyPrebuilds } from "./scripts/packaging/nodePtyPrebuilds";

export const packagingArtifactNames = {
  executableName: "InnocenceHarness",
  makerName: "InnocenceHarness",
  setupExe: "InnocenceHarnessSetup.exe",
} as const;

const pruneWindowsX64NodePtyPrebuilds: HookFunction = (buildPath, _electronVersion, platform, arch, callback) => {
  if (platform !== "win32" || arch !== "x64") {
    callback();
    return;
  }

  void pruneNodePtyPrebuilds(buildPath).then(() => callback(), callback);
};

export const config: ForgeConfig = {
  packagerConfig: {
    // App icon (Windows .ico with 16..256 PNG entries); rcedit stamps it
    // into the packaged executable at package time.
    icon: path.resolve(__dirname, "assets", "icon.ico"),
    asar: {
      // node-pty ships native .node binaries required at runtime — keep the
      // whole package (JS loader + prebuilds) outside the ASAR archive so
      // require("node-pty") works from the bundled main process.
      // @napi-rs/canvas 同理：附件图像规范化经 optionalDependencies 平台包
      // 装载预编译 Skia 二进制，同样必须以真实文件存在。
      unpack: "**/node_modules/{node-pty,@napi-rs}/**",
    },
    executableName: packagingArtifactNames.executableName,
    // Prebuilt kernel libraries and plugins live outside the ASAR archive:
    // plugins are loaded at runtime via dynamic import from resources/, so
    // they must stay as real files on disk (spec D10). @electron/packager
    // 18.4 accepts string entries only and copies each to
    // resources/<basename(entry)>, so listing the two staging children maps
    // directly to resources/plugins and resources/node_modules.
    extraResource: ["build/dist/resources/plugins", "build/dist/resources/node_modules", "assets"],
    // The pruner walks the ROOT production graph, which does not include
    // workspace packages' dependencies — node-pty (a dependency of the
    // workspace) would be pruned away. The ignore
    // filter below is the single source of truth for what ships; pruning is
    // therefore off.
    prune: false,
    // plugin-vite's default copy filter keeps ONLY /.vite — the runtime
    // requires vite.main.config.ts externalizes (node-pty; 附件解析的
    // @napi-rs/canvas 与 pdfjs-dist) would never reach the package and their
    // require() would fail in the packaged app. A function-valued ignore
    // takes over from the plugin: keep the .vite bundles, package.json and
    // those node_modules subtrees (natives unpacked above); every other
    // project file is already inlined into the bundles.
    ignore: (file) => {
      if (!file) return false; // the root path arrives empty — always keep it
      return (
        !file.startsWith("/.vite") &&
        file !== "/package.json" &&
        file !== "/node_modules" &&
        !file.startsWith("/node_modules/node-pty") &&
        !file.startsWith("/node_modules/@napi-rs") &&
        !file.startsWith("/node_modules/pdfjs-dist")
      );
    },
    afterCopy: [pruneWindowsX64NodePtyPrebuilds],
  },
  // cpu-features is the OPTIONAL crypto-acceleration dependency of the remote
  // shell dependency. It targets system-Node internals (not Electron/N-API)
  // and its node-gyp build fails against Electron headers, blocking the
  // "Preparing native dependencies" step. The shell library ships a pure-JS
  // fallback, so skipping its rebuild is safe; other native modules are
  // unaffected and still rebuild.
  rebuildConfig: { ignoreModules: ["cpu-features"] },
  makers: [
    new MakerSquirrel({
      name: packagingArtifactNames.makerName,
      setupExe: packagingArtifactNames.setupExe,
      // The setup exe and the uninstaller icon (iconUrl) use our own icon —
      // Squirrel otherwise falls back to the platform default.
      setupIcon: path.resolve(__dirname, "assets", "icon.ico"),
      iconUrl: "https://raw.githubusercontent.com/sgs844575/innocence-code/main/assets/icon.ico",
    }),
    new MakerZIP({}, ["win32"]),
  ],
  plugins: [
    new VitePlugin({
      // Bundles land in .vite/build/ (package.json "main": .vite/build/main.js).
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts" },
        { entry: "src/preload/index.ts", config: "vite.preload.config.ts" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
  ],
};

export default config;
