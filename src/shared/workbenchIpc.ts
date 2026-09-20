/** 工作台条目元数据（IPC workbench:list/create 载荷）：dir 是绝对目录
 *  （渲染层开对话绑定工作区用），不入盘——落盘的 workbench.json 只含
 *  id/name/createdAt/updatedAt（数据根迁移时路径不失效）。 */
export interface WorkbenchMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  dir: string;
}
export interface WorkbenchApi {
  workbenchList(): Promise<WorkbenchMeta[]>;
  workbenchCreate(name: string): Promise<WorkbenchMeta>;
  workbenchRemove(id: string): Promise<void>;
  workbenchWatch(id: string): Promise<void>;
  workbenchUnwatch(id: string): Promise<void>;
  /** 工作台目录内容变更（热刷新信号；200ms 去抖）。 */
  onWorkbenchChanged(cb: (payload: { id: string }) => void): () => void;
}
export const WorkbenchChannels = {
  workbenchList: "workbench:list", workbenchCreate: "workbench:create",
  workbenchRemove: "workbench:remove", workbenchWatch: "workbench:watch",
  workbenchUnwatch: "workbench:unwatch", workbenchChanged: "workbench:changed",
} as const;
