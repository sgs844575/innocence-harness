export type SidebarView = "groups" | "projects";
export type SidebarSort = "recent" | "created" | "name";
export type CapsuleSection = "environment" | "process" | "terminal" | "agent";
export type CapsulePlacement = "docked" | "overlay" | "sheet";

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
  | { type: "capsule/toggle" }
  | { type: "capsule/toggle-section"; section: CapsuleSection }
  | { type: "panel/select"; panel: WorkspacePresentationState["selectedPanel"] }
  | { type: "chat/width"; width: number };

export const CAPSULE_WIDTH = 286;

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
  contentMaxWidth: number;
  contentGutter: number;
  capsuleGap: number;
  capsulePlacement: CapsulePlacement;
}

export function workspaceLayoutForWidth(viewportWidth: number): WorkspaceLayout {
  if (viewportWidth < 640) {
    return { contentMaxWidth: 720, contentGutter: 16, capsuleGap: 0, capsulePlacement: "sheet" };
  }
  if (viewportWidth < 1340) {
    return { contentMaxWidth: 860, contentGutter: 24, capsuleGap: 16, capsulePlacement: "overlay" };
  }
  return { contentMaxWidth: 960, contentGutter: 32, capsuleGap: 24, capsulePlacement: "docked" };
}
