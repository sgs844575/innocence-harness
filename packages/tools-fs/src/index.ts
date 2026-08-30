import type { Context } from "@innocenceharness/kernel";
import { editTool } from "./edit";
import { createReadTool } from "./read";
import { createReadFileRegistry } from "./read-state";
import { globTool, grepTool } from "./search";
import { writeTool } from "./write";

export { editTool } from "./edit";
export { createReadTool } from "./read";
export {
  createReadFileRegistry,
  readContextKey,
  renderReadStateNote,
  type ReadFileRecord,
  type ReadFileRegistry,
  type ReadFileSignature,
} from "./read-state";
export { globTool, grepTool } from "./search";
export { writeTool } from "./write";
export { resolveWithin, walkFiles, IGNORED_DIRS } from "./paths";

/** Filesystem tools plugin — registers Read/Write/Edit/Glob/Grep. */
export const FsPlugin = {
  name: "fs",
  apply(ctx: Context) {
    // 会话级已读登记（M2 文件状态跟踪）：apply 每次会话组装运行，注册表随
    // 会话闭包生灭；子代理运行经 scope.parentInvocationId 自动分桶，不与
    // 父会话串读。
    const readFileRegistry = createReadFileRegistry();
    ctx.tools.register(createReadTool(readFileRegistry));
    ctx.tools.register(writeTool);
    ctx.tools.register(editTool);
    ctx.tools.register(globTool);
    ctx.tools.register(grepTool);
  },
};
export default FsPlugin;
