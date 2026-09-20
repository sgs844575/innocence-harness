const entries: Record<string, [string, string]> = {
  scope: ["命令范围", "Command scope"], global: ["用户", "User"], search: ["搜索命令…", "Search commands…"],
  installed: ["已安装", "Installed"], more: ["更多操作", "More actions"], refresh: ["刷新", "Refresh"],
  create: ["新建", "New"], import: ["导入", "Import"],
  delete: ["删除", "Delete"], confirm: ["确认删除", "Confirm deletion"], cancel: ["取消", "Cancel"],
  unavailable: ["当前环境不支持命令管理。", "Command management is unavailable."], loading: ["处理中…", "Working…"],
  empty: ["尚未安装命令", "No commands installed yet"],
  emptyHint: ["新建命令，或从外部 Agent 导入已有命令。", "Create a command, or import an existing one from an external agent."],
  noMatch: ["没有匹配的命令。", "No matching commands."],
  hint: ["范围内的命令在新建会话时生效；项目同名命令优先。", "Changes apply to new sessions; project commands take precedence."],
  createTitle: ["新建命令", "New command"],
  createHint: ["命令是会话中以 /名称 调用的提示词模板。", "A command is a prompt template invoked as /name in a session."],
  fieldName: ["名称", "Name"], fieldDescription: ["描述", "Description"], fieldBody: ["内容", "Content"],
  invalidName: ["名称需以小写字母或数字开头，只含小写字母、数字和连字符。", "Use lowercase letters, digits and hyphens, starting with a letter or digit."],
  submit: ["新建", "Create"], close: ["关闭", "Close"],
  importTitle: ["导入外部智能体命令", "Import external agent commands"],
  copyHint: ["复制到当前选定范围，保留源文件；同名命令不会覆盖。", "Copy into the selected scope, preserving sources and existing commands."],
  importScope: ["导入作用域", "Import scope"], all: ["全选", "Select all"],
  noImport: ["当前范围下没有可导入命令。", "No commands are available to import."],
};
export const commandsZh = { "settings.section.commands": "命令", ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [`settings.commands.${key}`, value[0]])) };
export const commandsEn = { "settings.section.commands": "Commands", ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [`settings.commands.${key}`, value[1]])) };
