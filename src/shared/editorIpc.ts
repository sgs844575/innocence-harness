export const EditorIpcChannels = {
  editorsList: "host:editors-list",
  editorsSelect: "host:editors-select",
  editorOpenWorkspace: "host:editor-open-workspace",
} as const;

export interface InstalledEditor {
  id: string;
  name: string;
  kind: "editor" | "fileManager" | "custom";
  icon?: string;
}

export interface EditorCatalog { editors: InstalledEditor[]; selectedId: string }
export type EditorWorkspaceTarget = { sessionId: string } | { workspaceRoot: string };

export interface EditorIpcApi {
  editorsList(refresh?: boolean): Promise<EditorCatalog>;
  editorsSelect(id: string): Promise<EditorCatalog>;
  editorOpenWorkspace(target: EditorWorkspaceTarget): Promise<void>;
}
