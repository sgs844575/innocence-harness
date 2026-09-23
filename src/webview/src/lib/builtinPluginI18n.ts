const labels: Record<string, [string, string, string, string]> = {
  fs: ["文件操作", "读取、查找与修改工作区文件。", "Files", "Read, search and edit workspace files."],
  shell: ["终端命令", "运行命令并收集输出。", "Shell commands", "Run commands and collect output."],
  subagent: ["子代理", "将独立任务交给专门的助手。", "Subagents", "Delegate independent tasks to specialized assistants."],
  skills: ["技能", "按需读取并使用工作流程。", "Skills", "Load and use workflows on demand."],
  mcp: ["工具服务器", "连接外部工具与数据服务。", "Tool servers", "Connect external tools and data services."],
  ssh: ["远程终端", "在已配置的远程主机上执行命令。", "Remote terminal", "Run commands on configured remote hosts."],
  archive: ["文件归档", "打包与整理工作区文件。", "File archives", "Package and organize workspace files."],
  todo: ["任务清单", "记录步骤并跟踪执行进度。", "Task checklist", "Track steps and task progress."],
  reference: ["参考资料", "按需检索任务相关资料。", "Reference material", "Retrieve relevant material when needed."],
  web: ["网页读取", "获取网页内容供任务使用。", "Web reading", "Retrieve web content for tasks."],
  computer: ["电脑控制", "查看屏幕并操作桌面应用。", "Computer control", "Read the screen and operate desktop apps."],
  "builtin-skills": ["内置技能集", "提供常用的开发和检查流程。", "Built-in workflows", "Common development and verification workflows."],
  reminders: ["任务提醒", "在执行过程中补充必要提示。", "Task reminders", "Provide relevant guidance during execution."],
  instructions: ["工作区指令", "新会话首次对话时注入工作区指令文件（AGENT.md）。", "Workspace instructions", "Inject the workspace instruction file (AGENT.md) into the first chat of new sessions."],
  "workspace-clean": ["工作区清洁", "任务完成后清理过程临时文件，优先使用工具完成工作。", "Workspace cleanup", "Clean scratch files after tasks; favor tool-first execution."],
  default: ["默认模式", "日常开发与通用任务。", "Default mode", "Everyday development and general tasks."],
  creation: ["创建模式", "创建可复用的插件与能力。", "Creation mode", "Create reusable plugins and capabilities."],
  plan: ["计划模式", "先分析需求并形成实施计划。", "Planning mode", "Analyze requirements and prepare an implementation plan."],
  focus: ["专注模式", "围绕当前目标集中执行。", "Focus mode", "Concentrate on the current objective."],
  minimal: ["精简模式", "以简洁的方式处理任务。", "Minimal mode", "Handle tasks with concise guidance."],
  learning: ["学习模式", "结合解释与示例理解问题。", "Learning mode", "Explore problems through explanations and examples."],
  auto: ["自主模式", "持续推进多步骤任务。", "Autonomous mode", "Continue working through multi-step tasks."],
  coordinator: ["协调模式", "组织多个助手共同完成任务。", "Coordinator mode", "Organize assistants around a shared task."],
  planflow: ["计划审批", "提交计划并等待确认。", "Plan approval", "Submit plans for review."],
  memory: ["记忆", "保存和读取长期工作偏好。", "Memory", "Save and retrieve long-term preferences."],
  hooks: ["自动化钩子", "在配置的事件发生时执行动作。", "Automation hooks", "Run configured actions when events occur."],
  team: ["团队协作", "在协作助手之间传递信息。", "Team collaboration", "Exchange messages between collaborating assistants."],
  ask: ["交互提问", "在需要补充信息时向用户提问。", "User questions", "Ask for missing information during tasks."],
  attachments: ["附件读取", "解析任务中的图片与文档。", "Attachments", "Read images and documents attached to tasks."],
  example: ["扩展示例", "用于演示插件界面的系统示例。", "Extension example", "A bundled example of plugin interface contributions."],
};
function dictionary(offset: number): Record<string, string> {
  return Object.fromEntries(Object.entries(labels).flatMap(([id, values]) => [
    [`settings.plugins.builtin.${id}`, values[offset]],
    [`settings.plugins.builtin.${id}.desc`, values[offset + 1]],
  ]));
}
export const builtinPluginZh = dictionary(0);
export const builtinPluginEn = dictionary(2);
