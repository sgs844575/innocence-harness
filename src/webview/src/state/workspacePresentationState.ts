export type SidebarView = "groups" | "projects";
export type SidebarSort = "recent" | "created" | "name";
export type CapsuleSection = "environment" | "process" | "terminal" | "agent";
export type CapsulePlacement = "floating" | "sheet";

export interface WorkspacePresentationState {
  sidebarView: SidebarView;
  sidebarCollapsed: boolean;
  expandedGroupIds: string[];
  expandedProjectIds: string[];
  collapsedProjectIds: string[];
  expandedCapsuleSections: CapsuleSection[];
  capsuleOpen: boolean;
  sidebarSort: SidebarSort;
  sidebarFilter: string;
  selectedFilePath?: string;
  selectedPanel?: "review" | "routes" | "code" | "terminal";
  chatContentMaxWidth: number;
}

export type WorkspacePresentationAction =
  | { type: "sidebar/view"; view: SidebarView }
  | { type: "sidebar/toggle" }
  | { type: "sidebar/filter"; filter: string }
  | { type: "sidebar/project-toggle"; projectId: string }
  | { type: "file/select"; path: string | undefined }
  | { type: "capsule/toggle" }
  | { type: "capsule/toggle-section"; section: CapsuleSection }
  | { type: "panel/select"; panel: WorkspacePresentationState["selectedPanel"] }
  | { type: "chat/width"; width: number };

export const CAPSULE_WIDTH = 319;

export const CAPSULE_SECTION_ORDER: readonly CapsuleSection[] = [
  "environment",
  "process",
  "terminal",
  "agent",
];

export const WORKSPACE_PRESENTATION_STORAGE_KEY = "workspace:presentation:v1";

export function restoreWorkspacePresentationState(raw: string | null): WorkspacePresentationState {
  if (raw === null) return defaultWorkspacePresentationState;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspacePresentationState>;
    const sidebarView = parsed.sidebarView === "groups" ? "groups" : "projects";
    const collapsedProjectIds = stringArray(parsed.collapsedProjectIds);
    const expandedCapsuleSections = stringArray(parsed.expandedCapsuleSections)
      .filter((section): section is CapsuleSection => CAPSULE_SECTION_ORDER.includes(section as CapsuleSection));
    return {
      ...defaultWorkspacePresentationState,
      sidebarView,
      collapsedProjectIds,
      expandedCapsuleSections: expandedCapsuleSections.length > 0 ? expandedCapsuleSections : defaultWorkspacePresentationState.expandedCapsuleSections,
      capsuleOpen: typeof parsed.capsuleOpen === "boolean" ? parsed.capsuleOpen : defaultWorkspacePresentationState.capsuleOpen,
    };
  } catch (error) {
    return defaultWorkspacePresentationState;
  }
}

export function persistWorkspacePresentationState(state: WorkspacePresentationState): string {
  return JSON.stringify({
    sidebarView: state.sidebarView,
    collapsedProjectIds: state.collapsedProjectIds,
    expandedCapsuleSections: state.expandedCapsuleSections,
    capsuleOpen: state.capsuleOpen,
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export const defaultWorkspacePresentationState: WorkspacePresentationState = {
  sidebarView: "projects",
  sidebarCollapsed: false,
  expandedGroupIds: [],
  expandedProjectIds: [],
  collapsedProjectIds: [],
  expandedCapsuleSections: ["environment", "process"],
  capsuleOpen: true,
  sidebarSort: "recent",
  sidebarFilter: "",
  selectedPanel: undefined,
  chatContentMaxWidth: 960,
};

export function reduceWorkspacePresentationState(
  state: WorkspacePresentationState,
  action: WorkspacePresentationAction,
): WorkspacePresentationState {
  switch (action.type) {
    case "sidebar/view":
      return { ...state, sidebarView: action.view };
    case "sidebar/toggle":
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case "sidebar/filter":
      return { ...state, sidebarFilter: action.filter };
    case "sidebar/project-toggle": {
      const collapsed = state.collapsedProjectIds.includes(action.projectId);
      return {
        ...state,
        collapsedProjectIds: collapsed
          ? state.collapsedProjectIds.filter((projectId) => projectId !== action.projectId)
          : [...state.collapsedProjectIds, action.projectId],
      };
    }
    case "file/select":
      return { ...state, selectedFilePath: action.path };
    case "capsule/toggle":
      return { ...state, capsuleOpen: !state.capsuleOpen };
    case "capsule/toggle-section": {
      const expanded = state.expandedCapsuleSections.includes(action.section);
      return {
        ...state,
        expandedCapsuleSections: expanded
          ? state.expandedCapsuleSections.filter((section) => section !== action.section)
          : [...state.expandedCapsuleSections, action.section],
      };
    }
    case "panel/select":
      return { ...state, selectedPanel: action.panel };
    case "chat/width":
      return { ...state, chatContentMaxWidth: Math.max(640, Math.round(action.width)) };
  }
}

export interface WorkspaceLayout {
  /** 消息列宽度封顶（参考稿 .col max-width:1120px；窗口更窄时吃满余量）。 */
  contentMaxWidth: number;
  /** 滚动区左留白（与右留白等大，保证聊天主体在窗口中轴居中）。 */
  contentGutter: number;
  /** 滚动区右留白（与左留白等大，详见 contentGutter）。 */
  contentRightGutter: number;
  capsulePlacement: CapsulePlacement;
}

/** 参考稿实测：正文列 1120px 封顶；左右留白等大（24..100px 呼吸，超出封顶后同步等比扩张）。 */
export const CHAT_CONTENT_MAX_WIDTH = 1120;
const CHAT_GUTTER_MAX = 100;
const CHAT_GUTTER_MIN = 24;

export function workspaceLayoutForWidth(viewportWidth: number): WorkspaceLayout {
  // 满宽滚动 + 流体收缩内容列：滚动区铺满主列（滚动条贴窗口最右缘），
  // 左右留白等大——随窗口宽度 8% 同步呼吸（24..100px），正文/输入盒吃满
  // 余量并在 1120px 封顶；窗口超过 1320px 后列封顶，左右留白等比扩张
  // 保证聊天主体始终居中。胶囊悬浮其上不占列。
  if (viewportWidth < 640) {
    return {
      contentMaxWidth: viewportWidth,
      contentGutter: 16,
      contentRightGutter: 16,
      capsulePlacement: "sheet",
    };
  }
  const idealGutter = Math.min(CHAT_GUTTER_MAX, Math.max(CHAT_GUTTER_MIN, Math.round(viewportWidth * 0.08)));
  const contentMaxWidth = Math.min(CHAT_CONTENT_MAX_WIDTH, viewportWidth - 2 * idealGutter);
  const gutter = (viewportWidth - contentMaxWidth) / 2;
  return {
    contentMaxWidth,
    contentGutter: gutter,
    contentRightGutter: gutter,
    capsulePlacement: "floating",
  };
}
