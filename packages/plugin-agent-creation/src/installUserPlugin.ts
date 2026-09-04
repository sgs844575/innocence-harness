import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Tool } from "@innocenceharness/harness-tools";

/**
 * id 必须是单段安全目录名（防路径逃逸）。对齐宿主加载器的 plain-plugin-id
 * 规则（拒绝点前缀、路径分隔符、驱动器号），拒绝首尾空白；因此 "."、
 * ".."、".hidden"、"C:" 一律非法。
 */
function validSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !value.startsWith(".") &&
    !/[\\/:]/.test(value)
  );
}

/**
 * install_user_plugin：把创造模式产出的免构建用户插件写入用户插件根。
 * 只写 <userRoot>/<id>/{package.json, dist/index.js, dist/client.js?}；
 * 覆写已有目录必须显式 overwrite:true（并经权限 ask 门控）。
 */
export function createInstallUserPluginTool(options: { userRoot: string }): Tool {
  return {
    name: "install_user_plugin",
    description:
      "Install a no-build user plugin into the harness user plugin root " +
      "(writes package.json + dist/index.js, optional dist/client.js). Requires " +
      "overwrite:true to replace an existing plugin directory.",
    readOnly: false,
    sideEffect: "paths",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Plugin id (single path segment)" },
        packageJson: { type: "string", description: "Full package.json file content" },
        indexJs: { type: "string", description: "Full dist/index.js ESM plugin source" },
        clientJs: { type: "string", description: "Optional renderer plugin (dist/client.js)" },
        overwrite: { type: "boolean", description: "Must be true to replace an existing plugin" },
      },
      required: ["id", "packageJson", "indexJs"],
    },
    validateArgs(args) {
      if (!validSegment(args.id)) throw new Error("id 必须是非空单段目录名（禁止路径分隔符）");
      if (typeof args.packageJson !== "string" || args.packageJson.trim().length === 0)
        throw new Error("缺少必填参数 packageJson");
      if (typeof args.indexJs !== "string" || args.indexJs.trim().length === 0)
        throw new Error("缺少必填参数 indexJs");
      if (args.clientJs !== undefined && typeof args.clientJs !== "string")
        throw new Error("clientJs 必须是字符串");
      if (args.overwrite !== undefined && typeof args.overwrite !== "boolean")
        throw new Error("overwrite 必须是布尔值");
    },
    permissionResource(args) {
      return {
        action: "write",
        kind: "plugin",
        scope: validSegment(args.id) ? `user-root:${args.id}` : "user-root:invalid",
      };
    },
    async execute(args) {
      const id = args.id;
      if (!validSegment(id)) return { content: "id 非法（路径分隔符或空）", isError: true };
      // execute must fail closed on its own: validateArgs narrowing does not
      // carry into this signature (args stay Record<string, unknown>).
      const packageJson = typeof args.packageJson === "string" ? args.packageJson : "";
      const indexJs = typeof args.indexJs === "string" ? args.indexJs : "";
      if (!packageJson.trim() || !indexJs.trim()) {
        return { content: "缺少必填参数 packageJson 或 indexJs", isError: true };
      }
      const dir = path.join(options.userRoot, id);
      const dist = path.join(dir, "dist");
      try {
        if (existsSync(dir) && args.overwrite !== true) {
          return { content: `插件目录已存在：${id}；确认替换需显式 overwrite:true`, isError: true };
        }
        await mkdir(dist, { recursive: true });
        await writeFile(path.join(dir, "package.json"), packageJson, "utf8");
        await writeFile(path.join(dist, "index.js"), indexJs, "utf8");
        if (typeof args.clientJs === "string" && args.clientJs) {
          await writeFile(path.join(dist, "client.js"), args.clientJs, "utf8");
        }
        return { content: `已安装用户插件 ${id}（下次会话构建时装载；可在插件清单中关闭）` };
      } catch (err) {
        return { content: `安装失败：${String(err)}`, isError: true };
      }
    },
  };
}
