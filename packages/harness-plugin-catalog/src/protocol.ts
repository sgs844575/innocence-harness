export interface RepositorySource {
  url: string;
  ref?: string;
  path?: string;
}
export interface CatalogEntry {
  name: string;
  description: string;
  version?: string;
  category?: string;
  source?: RepositorySource;
  unavailable?: string;
}
export interface Marketplace {
  id: string;
  title: string;
  source: RepositorySource;
  updatedAt: string;
  syncing?: boolean;
  syncError?: string;
  entries: CatalogEntry[];
}
export interface PluginMetadata {
  name: string;
  title: string;
  description: string;
  version: string;
  format: "native" | "bundle";
  components: string[];
  unsupported: string[];
  installable: boolean;
}
export interface InstalledPlugin extends PluginMetadata {
  id: string;
  source: RepositorySource;
  commit: string;
  installedAt: string;
}
export interface InstallPreview extends PluginMetadata {
  token: string;
  id: string;
  source: RepositorySource;
  commit: string;
  replacing: boolean;
}
export interface CatalogSnapshot {
  markets: Marketplace[];
  installed: InstalledPlugin[];
}
export interface CatalogService {
  snapshot(): Promise<CatalogSnapshot>;
  addMarket(source: RepositorySource): Promise<void>;
  refreshMarket(id: string): Promise<void>;
  removeMarket(id: string): Promise<void>;
  preview(source: RepositorySource): Promise<InstallPreview>;
  install(token: string): Promise<void>;
  discard(token: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  dispose(): Promise<void>;
}
