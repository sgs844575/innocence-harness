import type { Context } from "@innocenceharness/kernel";
import { createWebFetchTool } from "./fetchTool";

/** Web tools plugin — registers web_fetch (staging id "web"). */
export const WebPlugin = {
  name: "web" as const,
  apply(ctx: Context) {
    ctx.tools.register(createWebFetchTool());
  },
};
export default WebPlugin;

export {
  createWebFetchTool,
  DEFAULT_FETCH_TIMEOUT_MS,
  resetWebFetchDispatcher,
  type FetchLike,
  type FetchResponseLike,
  type WebFetchToolDependencies,
} from "./fetchTool";
export { isPrivateHost, parseWebTarget, type ParsedWebTarget } from "./url-guard";
