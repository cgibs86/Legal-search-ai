import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentityCorrection } from "@/lib/domain/identity";
import type { AlertItem, Project, ProjectItem, SavedSearch, Watchlist, WorkspaceRepo } from "./types";

/**
 * Workspace data access through the user's RLS-bound Supabase client. Every query is
 * additionally scoped to `userId` so a policy mistake cannot silently widen access.
 */
type Row = Record<string, unknown>;

/* eslint-disable @typescript-eslint/no-explicit-any */
function must(res: { data: unknown; error: { message: string } | null }): any[] & Row {
  if (res.error) throw new Error(res.error.message);
  return res.data as any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const toProject = (r: Row, itemCount = 0, role: Project["role"] = "owner"): Project => ({
  id: r.id as string,
  name: r.name as string,
  description: (r.description as string) ?? null,
  role,
  itemCount,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const toItem = (r: Row): ProjectItem => ({
  id: r.id as string,
  projectId: r.project_id as string,
  kind: r.kind as ProjectItem["kind"],
  title: r.title as string,
  ref: (r.ref as Record<string, unknown>) ?? {},
  note: (r.note as string) ?? null,
  createdAt: r.created_at as string,
});

const toWatch = (r: Row): Watchlist => ({
  id: r.id as string,
  kind: r.kind as Watchlist["kind"],
  label: r.label as string,
  query: (r.query as Watchlist["query"]) ?? {},
  frequency: r.frequency as Watchlist["frequency"],
  channels: (r.channels as Watchlist["channels"]) ?? { email: true, in_app: true },
  active: Boolean(r.active),
  lastCheckedAt: (r.last_checked_at as string) ?? null,
  createdAt: r.created_at as string,
});

const toAlert = (r: Row): AlertItem => ({
  id: r.id as string,
  watchlistId: (r.watchlist_id as string) ?? null,
  kind: r.kind as AlertItem["kind"],
  title: r.title as string,
  summary: r.summary as string,
  payload: (r.payload as Record<string, unknown>) ?? {},
  readAt: (r.read_at as string) ?? null,
  createdAt: r.created_at as string,
});

export function supabaseRepo(db: SupabaseClient, userId: string): WorkspaceRepo {
  return {
    userId,
    async listSavedSearches() {
      const rows = must(await db.from("searches").select("id, saved_name, query_text, entity_type, filters, created_at").eq("user_id", userId).eq("saved", true).order("created_at", { ascending: false }));
      return rows.map((r: any): SavedSearch => ({ id: r.id, name: r.saved_name ?? r.query_text ?? "Saved search", query: r.query_text ?? "", entityType: r.entity_type, filters: r.filters ?? {}, createdAt: r.created_at }));
    },
    async saveSearch(input) {
      const r = must(
        await db
          .from("searches")
          .insert({ user_id: userId, saved: true, saved_name: input.name, query_text: input.query, entity_type: input.entityType, filters: input.filters, status: "saved", data_mode: "n/a" })
          .select("id, created_at")
          .single(),
      );
      return { ...input, id: String(r.id), createdAt: String(r.created_at) };
    },
    async deleteSavedSearch(id) {
      must(await db.from("searches").delete().eq("id", id).eq("user_id", userId));
    },
    async logSearch(input) {
      // Person-search text is kept only in the user's own RLS-protected history.
      await db.from("searches").insert({
        user_id: userId,
        entity_type: input.entityType,
        query_text: input.query,
        filters: input.filters,
        result_count: input.resultCount,
        status: input.status,
        data_mode: input.dataMode,
      });
    },
    async listProjects() {
      const rows = must(await db.from("projects").select("id, name, description, owner_id, created_at, updated_at, project_items(count)").order("updated_at", { ascending: false }));
      return rows.map((r: Row) => toProject(r as Row, ((r as Row).project_items as { count: number }[] | undefined)?.[0]?.count ?? 0, (r as Row).owner_id === userId ? "owner" : "viewer"));
    },
    async createProject(input) {
      const r = must(await db.from("projects").insert({ owner_id: userId, name: input.name, description: input.description ?? null }).select("*").single());
      await db.from("project_members").insert({ project_id: (r as Row).id, user_id: userId, role: "owner" });
      return toProject(r as Row);
    },
    async getProject(id) {
      const { data: p } = await db.from("projects").select("*").eq("id", id).maybeSingle();
      if (!p) return null;
      const items = must(await db.from("project_items").select("*").eq("project_id", id).order("created_at", { ascending: false }));
      return { project: toProject(p as Row, items.length, (p as Row).owner_id === userId ? "owner" : "viewer"), items: items.map((i: Row) => toItem(i)) };
    },
    async deleteProject(id) {
      must(await db.from("projects").delete().eq("id", id).eq("owner_id", userId));
    },
    async addProjectItem(projectId, item) {
      const r = must(await db.from("project_items").insert({ project_id: projectId, added_by: userId, kind: item.kind, title: item.title.slice(0, 300), ref: item.ref, note: item.note ?? null }).select("*").single());
      await db.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", projectId);
      return toItem(r as Row);
    },
    async updateProjectItem(projectId, itemId, patch) {
      must(await db.from("project_items").update(patch).eq("id", itemId).eq("project_id", projectId));
    },
    async removeProjectItem(projectId, itemId) {
      must(await db.from("project_items").delete().eq("id", itemId).eq("project_id", projectId));
    },
    async listWatchlists() {
      const rows = must(await db.from("watchlists").select("*").eq("user_id", userId).order("created_at", { ascending: false }));
      return rows.map((r: Row) => toWatch(r));
    },
    async createWatchlist(input) {
      const r = must(
        await db
          .from("watchlists")
          .insert({ user_id: userId, kind: input.kind, label: input.label.slice(0, 200), query: input.query, frequency: input.frequency, channels: input.channels })
          .select("*")
          .single(),
      );
      return toWatch(r as Row);
    },
    async updateWatchlist(id, patch) {
      must(await db.from("watchlists").update(patch).eq("id", id).eq("user_id", userId));
    },
    async deleteWatchlist(id) {
      must(await db.from("watchlists").delete().eq("id", id).eq("user_id", userId));
    },
    async countActiveWatchlists() {
      const { count } = await db.from("watchlists").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("active", true);
      return count ?? 0;
    },
    async listAlerts(opts) {
      let q = db.from("alerts").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(opts?.limit ?? 100);
      if (opts?.unreadOnly) q = q.is("read_at", null);
      const rows = must(await q);
      return rows.map((r: Row) => toAlert(r));
    },
    async markAlertRead(id) {
      must(await db.from("alerts").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId));
    },
    async markAllAlertsRead() {
      must(await db.from("alerts").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null));
    },
    async unreadAlertCount() {
      const { count } = await db.from("alerts").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
      return count ?? 0;
    },
    async listCorrections(entityKey) {
      const rows = must(await db.from("identity_corrections").select("*").eq("user_id", userId).eq("entity_key", entityKey).order("created_at"));
      return rows.map((r: any): IdentityCorrection => ({
        entityKey: r.entity_key,
        recordKey: r.record_key,
        action: r.action,
        targetClusterId: r.target_cluster_key,
        sourceClusterId: r.source_cluster_key,
        createdAt: r.created_at,
      }));
    },
    async addCorrection(c) {
      const r = must(
        await db
          .from("identity_corrections")
          .insert({ user_id: userId, entity_key: c.entityKey, record_key: c.recordKey, action: c.action, target_cluster_key: c.targetClusterId, source_cluster_key: c.sourceClusterId })
          .select("created_at")
          .single(),
      );
      return { ...c, createdAt: (r as Row).created_at as string };
    },
    async clearCorrections(entityKey) {
      must(await db.from("identity_corrections").delete().eq("user_id", userId).eq("entity_key", entityKey));
    },
  };
}
