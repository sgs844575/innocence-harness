import type { Context } from "@innocenceharness/kernel";
import { createEditTool } from "./edit";
import { createReadTool } from "./read";
import { createReadFileRegistry } from "./read-state";
import { createGlobTool, createGrepTool } from "./search";
import { createWriteTool } from "./write";
import type { FsPluginConfig } from "./config";

export { createEditTool, editTool } from "./edit";
export { createReadTool } from "./read";
export {
  createReadFileRegistry,
  readContextKey,
  renderReadStateNote,
  type ReadFileRecord,
  type ReadFileRegistry,
  type ReadFileSignature,
} from "./read-state";
export { createGlobTool, createGrepTool, globTool, grepTool } from "./search";
export { createWriteTool, writeTool } from "./write";
export { resolveWithin, walkFiles, IGNORED_DIRS } from "./paths";
export type { FsPluginConfig } from "./config";

/**
 * Filesystem tools plugin factory — registers Read/Write/Edit/Glob/Grep.
 * The staged default export is THIS factory: hosts assemble the config from
 * the session's settings snapshot (enhancedFindGrep → searchEngine); the
 * zero-config defaults match the settings defaults.
 */
export function createFsPlugin(config: FsPluginConfig = {}) {
  return {
    name: "fs",
    apply(ctx: Context) {
      // 会话级已读登记（M2 文件状态跟踪）：apply 每次会话组装运行，注册表随
      // 会话闭包生灭；子代理运行经 scope.parentInvocationId 自动分桶，不与
      // 父会话串读。
      const readFileRegistry = createReadFileRegistry();
      ctx.tools.register(createReadTool(readFileRegistry));
      ctx.tools.register(createWriteTool());
      ctx.tools.register(createEditTool());
      ctx.tools.register(createGlobTool(config));
      ctx.tools.register(createGrepTool(config));
    },
  };
}

/** Zero-config plugin. */
export const FsPlugin = createFsPlugin();

// Distribution default (kernel-loader unwrapExports convention): the factory,
// so a disk-loaded module resolves to the single entry point hosts configure.
export default createFsPlugin;
