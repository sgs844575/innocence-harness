const entries: Record<string, [string, string]> = {
  scope: ["钩子范围", "Hook scope"], global: ["用户", "User"], search: ["搜索钩子…", "Search hooks…"],
  installed: ["已安装", "Installed"], refresh: ["刷新", "Refresh"],
  create: ["新建", "New"], createTitle: ["新建钩子", "New hook"],
  delete: ["删除", "Delete"], confirm: ["确认删除", "Confirm deletion"], cancel: ["取消", "Cancel"],
  unavailable: ["当前环境不支持钩子管理。", "Hook management is unavailable."], loading: ["处理中…", "Working…"],
  empty: ["尚未安装钩子", "No hooks installed yet"],
  emptyHint: ["新建钩子，以在任务生命周期事件中运行命令。", "Create a hook to run a command on task lifecycle events."],
  noMatch: ["没有匹配的钩子。", "No matching hooks."],
  overrideNote: ["项目级钩子整体覆盖用户级钩子。", "Project hooks replace user hooks as a whole."],
  hint: ["范围内的钩子在新建会话时生效；命令按空白拆分，不支持引号。", "Changes apply to new sessions; commands split on whitespace with no quoting."],
  createHint: ["钩子追加到所选作用域配置文件的 hooks 列表。", "The hook is appended to the hooks list of the selected scope's config file."],
  fieldEvent: ["事件", "Event"], fieldCommand: ["命令", "Command"], fieldMatch: ["匹配", "Match"],
  fieldTimeout: ["超时（毫秒）", "Timeout (ms)"], fieldCondition: ["条件", "Condition"],
  invalidEntry: ["无效条目", "Invalid entry"],
  invalidForm: ["事件必选、命令不能为空；超时需为不超过 30000 的正数。", "Event is required, command must be non-empty, and timeout must be positive and at most 30000."],
  submit: ["新建", "Create"], close: ["关闭", "Close"],
};
export const hooksZh = { "settings.section.hooks": "钩子", ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [`settings.hooks.${key}`, value[0]])) };
export const hooksEn = { "settings.section.hooks": "Hooks", ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [`settings.hooks.${key}`, value[1]])) };
