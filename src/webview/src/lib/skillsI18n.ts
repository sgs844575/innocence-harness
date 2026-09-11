const entries: Record<string, [string, string]> = {
  importScope: ["导入作用域", "Import scope"],
  pagination: ["技能分页", "Skill pages"], previous: ["上一页", "Previous page"], next: ["下一页", "Next page"],
  provided: ["其他可用技能", "Other available skills"],
  scope: ["技能范围", "Skill scope"], global: ["用户", "User"], search: ["搜索技能…", "Search skills…"],
  installed: ["已安装", "Installed"], more: ["更多操作", "More actions"], refresh: ["刷新", "Refresh"],
  create: ["新建技能", "New skill"], import: ["导入", "Import"], enabled: ["启用", "Enable"],
  delete: ["删除", "Delete"], confirm: ["确认删除", "Confirm deletion"], cancel: ["取消", "Cancel"],
  unavailable: ["当前环境不支持技能管理。", "Skill management is unavailable."], loading: ["处理中…", "Working…"],
  empty: ["没有匹配的技能。", "No matching skills."], hint: ["范围内的技能在新建会话时生效；项目同名技能优先。", "Changes apply to new sessions; project skills take precedence."],
  createHint: ["描述需要的工作流程，由技能创建智能体完成编写和验证。", "Describe your workflow. The skill creation agent will write and validate it."],
  request: ["这个技能需要完成什么？", "What should this skill do?"], start: ["开始创建", "Start creation"],
  importTitle: ["导入外部智能体技能", "Import external agent skills"], copyHint: ["复制到当前选定范围，保留源文件；同名技能不会覆盖。", "Copy into the selected scope, preserving sources and existing skills."],
  all: ["全选", "Select all"], noImport: ["当前范围下没有可导入技能。", "No skills are available to import."],
};
export const skillsZh = { "agentMode.skills-creator": "技能创建", "agentMode.skills-creator.desc": "编写和验证可复用的技能", "settings.section.skills": "技能", ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [`settings.skills.${key}`, value[0]])) };
export const skillsEn = { "agentMode.skills-creator": "Skill Creation", "agentMode.skills-creator.desc": "Create and validate reusable skills", "settings.section.skills": "Skills", ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [`settings.skills.${key}`, value[1]])) };
