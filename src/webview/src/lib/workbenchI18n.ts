const entries: Record<string, [string, string]> = {
  create: ["新建工作台", "New workbench"], open: ["打开", "Open"], editChat: ["在对话中编辑", "Edit in chat"],
  delete: ["删除", "Delete"], confirm: ["确认删除", "Confirm deletion"], cancel: ["取消", "Cancel"],
  refresh: ["刷新", "Refresh"], back: ["返回", "Back"],
  loading: ["处理中…", "Working…"], unavailable: ["当前环境不支持工作台。", "Workbench is unavailable."],
  empty: ["还没有工作台", "No workbenches yet"],
  emptyHint: ["通过对话让 Agent 为你搭建专属工作台。", "Ask the agent in chat to build your personal workbench."],
  createTitle: ["新建工作台", "New workbench"],
  createHint: ["创建后会打开对话，由助手在该目录中搭建应用文件。", "After creating, a chat opens where the agent builds the app files in that directory."],
  fieldName: ["名称", "Name"], fieldDesc: ["需求描述", "Description"],
  descPlaceholder: ["想让这个工作台做什么？（可选）", "What should this workbench do? (optional)"],
  invalidName: ["名称不能为空。", "Name is required."],
  submit: ["创建", "Create"], close: ["关闭", "Close"],
};
export const workbenchZh = { "sidebar.nav.workbench": "工作台", "workbench.title": "工作台", ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [`workbench.${key}`, value[0]])) };
export const workbenchEn = { "sidebar.nav.workbench": "Workbench", "workbench.title": "Workbench", ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [`workbench.${key}`, value[1]])) };
