import "server-only";
import { randomUUID } from "node:crypto";
import type { IdentityCorrection } from "@/lib/domain/identity";
import type { AlertItem, Project, ProjectItem, SavedSearch, Watchlist, WorkspaceRepo } from "./types";

/**
 * In-memory workspace store used ONLY for the labeled demo workspace (no Supabase configured).
 * Data lives in server memory and resets on restart. Never used when auth is configured.
 */
interface Store {
  savedSearches: SavedSearch[];
  projects: Project[];
  items: ProjectItem[];
  watchlists: (Watchlist & { seen: string[]; snapshot: unknown })[];
  alerts: AlertItem[];
  corrections: IdentityCorrection[];
}

const g = globalThis as unknown as { __lsaMemory?: Map<string, Store> };
g.__lsaMemory ??= new Map();

export function memoryStore(userId: string): Store {
  let s = g.__lsaMemory!.get(userId);
  if (!s) {
    s = { savedSearches: [], projects: [], items: [], watchlists: [], alerts: [], corrections: [] };
    g.__lsaMemory!.set(userId, s);
  }
  return s;
}

export function allMemoryStores(): [string, Store][] {
  return [...g.__lsaMemory!.entries()];
}

const now = () => new Date().toISOString();

export function memoryRepo(userId: string): WorkspaceRepo {
  const s = memoryStore(userId);
  return {
    userId,
    async listSavedSearches() {
      return [...s.savedSearches].reverse();
    },
    async saveSearch(input) {
      const row = { ...input, id: randomUUID(), createdAt: now() };
      s.savedSearches.push(row);
      return row;
    },
    async deleteSavedSearch(id) {
      s.savedSearches = s.savedSearches.filter((x) => x.id !== id);
    },
    async logSearch() {
      /* demo workspace keeps no search history */
    },
    async listProjects() {
      return s.projects.map((p) => ({ ...p, itemCount: s.items.filter((i) => i.projectId === p.id).length })).reverse();
    },
    async createProject(input) {
      const p: Project = { id: randomUUID(), name: input.name, description: input.description ?? null, role: "owner", itemCount: 0, createdAt: now(), updatedAt: now() };
      s.projects.push(p);
      return p;
    },
    async getProject(id) {
      const project = s.projects.find((p) => p.id === id);
      if (!project) return null;
      const items = s.items.filter((i) => i.projectId === id).reverse();
      return { project: { ...project, itemCount: items.length }, items };
    },
    async deleteProject(id) {
      s.projects = s.projects.filter((p) => p.id !== id);
      s.items = s.items.filter((i) => i.projectId !== id);
    },
    async addProjectItem(projectId, item) {
      if (!s.projects.some((p) => p.id === projectId)) throw new Error("Project not found");
      const row: ProjectItem = { id: randomUUID(), projectId, kind: item.kind, title: item.title, ref: item.ref, note: item.note ?? null, createdAt: now() };
      s.items.push(row);
      const p = s.projects.find((x) => x.id === projectId)!;
      p.updatedAt = now();
      return row;
    },
    async updateProjectItem(projectId, itemId, patch) {
      const it = s.items.find((i) => i.id === itemId && i.projectId === projectId);
      if (it) Object.assign(it, patch);
    },
    async removeProjectItem(projectId, itemId) {
      s.items = s.items.filter((i) => !(i.id === itemId && i.projectId === projectId));
    },
    async listWatchlists() {
      return s.watchlists.map(({ seen: _seen, snapshot: _snap, ...w }) => w).reverse();
    },
    async createWatchlist(input) {
      const w = { ...input, id: randomUUID(), active: true, lastCheckedAt: null, createdAt: now(), seen: [], snapshot: null };
      s.watchlists.push(w);
      const { seen: _seen, snapshot: _snap, ...pub } = w;
      return pub;
    },
    async updateWatchlist(id, patch) {
      const w = s.watchlists.find((x) => x.id === id);
      if (w) Object.assign(w, patch);
    },
    async deleteWatchlist(id) {
      s.watchlists = s.watchlists.filter((x) => x.id !== id);
    },
    async countActiveWatchlists() {
      return s.watchlists.filter((w) => w.active).length;
    },
    async listAlerts(opts) {
      const rows = [...s.alerts].reverse().filter((a) => !opts?.unreadOnly || !a.readAt);
      return rows.slice(0, opts?.limit ?? 100);
    },
    async markAlertRead(id) {
      const a = s.alerts.find((x) => x.id === id);
      if (a) a.readAt = now();
    },
    async markAllAlertsRead() {
      for (const a of s.alerts) a.readAt ??= now();
    },
    async unreadAlertCount() {
      return s.alerts.filter((a) => !a.readAt).length;
    },
    async listCorrections(entityKey) {
      return s.corrections.filter((c) => c.entityKey === entityKey);
    },
    async addCorrection(c) {
      const row = { ...c, createdAt: now() };
      s.corrections.push(row);
      return row;
    },
    async clearCorrections(entityKey) {
      s.corrections = s.corrections.filter((c) => c.entityKey !== entityKey);
    },
  };
}
