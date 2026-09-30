import type { EntityType, SearchFilters } from "@/lib/domain/types";
import type { IdentityCorrection } from "@/lib/domain/identity";

export type ProjectItemKind = "entity" | "case" | "docket" | "filing" | "note" | "ai_summary" | "timeline_item" | "graph_view" | "search";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  role: "owner" | "editor" | "viewer";
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectItem {
  id: string;
  projectId: string;
  kind: ProjectItemKind;
  title: string;
  ref: Record<string, unknown>;
  note: string | null;
  createdAt: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  entityType: EntityType;
  filters: SearchFilters;
  createdAt: string;
}

export type WatchKind = "person" | "company" | "case" | "docket" | "attorney" | "law_firm" | "search";
export type AlertFrequency = "immediate" | "daily" | "weekly";

export interface Watchlist {
  id: string;
  kind: WatchKind;
  label: string;
  query: { query?: string; entityType?: EntityType; filters?: SearchFilters; provider?: string; docketId?: string; recordKey?: string };
  frequency: AlertFrequency;
  channels: { email: boolean; in_app: boolean };
  active: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface AlertItem {
  id: string;
  watchlistId: string | null;
  kind: "new_record" | "docket_diff" | "status_change" | "system";
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface WorkspaceRepo {
  readonly userId: string;
  listSavedSearches(): Promise<SavedSearch[]>;
  saveSearch(input: Omit<SavedSearch, "id" | "createdAt">): Promise<SavedSearch>;
  deleteSavedSearch(id: string): Promise<void>;
  logSearch(input: { entityType: EntityType; query: string | null; filters: SearchFilters; resultCount: number; status: string; dataMode: string }): Promise<void>;

  listProjects(): Promise<Project[]>;
  createProject(input: { name: string; description?: string | null }): Promise<Project>;
  getProject(id: string): Promise<{ project: Project; items: ProjectItem[] } | null>;
  deleteProject(id: string): Promise<void>;
  addProjectItem(projectId: string, item: { kind: ProjectItemKind; title: string; ref: Record<string, unknown>; note?: string | null }): Promise<ProjectItem>;
  updateProjectItem(projectId: string, itemId: string, patch: { note?: string | null; title?: string }): Promise<void>;
  removeProjectItem(projectId: string, itemId: string): Promise<void>;

  listWatchlists(): Promise<Watchlist[]>;
  createWatchlist(input: Omit<Watchlist, "id" | "createdAt" | "lastCheckedAt" | "active">): Promise<Watchlist>;
  updateWatchlist(id: string, patch: Partial<Pick<Watchlist, "frequency" | "channels" | "active" | "label">>): Promise<void>;
  deleteWatchlist(id: string): Promise<void>;
  countActiveWatchlists(): Promise<number>;

  listAlerts(opts?: { unreadOnly?: boolean; limit?: number }): Promise<AlertItem[]>;
  markAlertRead(id: string): Promise<void>;
  markAllAlertsRead(): Promise<void>;
  unreadAlertCount(): Promise<number>;

  listCorrections(entityKey: string): Promise<IdentityCorrection[]>;
  addCorrection(c: Omit<IdentityCorrection, "createdAt">): Promise<IdentityCorrection>;
  clearCorrections(entityKey: string): Promise<void>;
}
