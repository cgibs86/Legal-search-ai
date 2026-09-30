-- Legal Search AI — initial schema
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
-- Principles:
--   * Row-level security on every table. User data is readable only by its owner (or
--     project members). Shared public-record caches are read-only for signed-in users.
--   * Service-role only: caches, budgets, usage/analytics events, Stripe events.
--   * Minimal personal data: no addresses, phone numbers or raw search text for person
--     searches in operational tables.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  onboarded_at timestamptz,
  accepted_terms_at timestamptz,
  permissible_use_ack_at timestamptz,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'The spec''s "users" table: one row per auth.users row.';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- billing
create table if not exists public.subscriptions (
  id text primary key,                          -- Stripe subscription id
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null check (plan_id in ('search','research_pro','intelligence')),
  status text not null,                         -- Stripe status: trialing, active, past_due, canceled, ...
  stripe_customer_id text not null,
  stripe_price_id text,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id, status);

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- searches
create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  entity_type text not null,
  -- Query text is stored only for the signed-in user's own history (RLS-protected).
  query_text text,
  filters jsonb not null default '{}'::jsonb,
  result_count integer not null default 0,
  status text not null,
  data_mode text not null,
  saved boolean not null default false,
  saved_name text,
  created_at timestamptz not null default now()
);
create index if not exists searches_user_idx on public.searches(user_id, created_at desc);

create table if not exists public.search_results (
  id bigint generated always as identity primary key,
  search_id uuid not null references public.searches(id) on delete cascade,
  record_key text not null,
  match_types text[] not null,
  rank integer not null,
  created_at timestamptz not null default now()
);
create index if not exists search_results_search_idx on public.search_results(search_id);

-- ---------------------------------------------------------------- entities & identity
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null unique,              -- e.g. "company:epic games inc"
  entity_type text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.entity_aliases (
  id bigint generated always as identity primary key,
  entity_id uuid not null references public.entities(id) on delete cascade,
  alias text not null,
  alias_kind text not null,                     -- variant kind
  unique (entity_id, alias)
);

create table if not exists public.identity_clusters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_key text not null,
  label text,
  anchor_record_key text not null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists identity_clusters_user_idx on public.identity_clusters(user_id, entity_key);

create table if not exists public.identity_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_key text not null,
  record_key text not null,
  action text not null check (action in ('confirm','reject','move','split','merge')),
  target_cluster_key text,
  source_cluster_key text,
  created_at timestamptz not null default now()
);
create index if not exists identity_corrections_idx on public.identity_corrections(user_id, entity_key, created_at);

-- ---------------------------------------------------------------- public-record cache (normalized)
create table if not exists public.courts (
  id text primary key,
  name text not null,
  citation text,
  level text not null,
  court_type text not null,
  state text,
  jurisdiction_code text
);

create table if not exists public.cases (
  record_key text primary key,                  -- normalized court|docket key
  case_name text not null,
  court_id text,
  docket_number text,
  date_filed date,
  date_terminated date,
  last_activity date,
  status text,
  category text,
  nature_of_suit text,
  judge text,
  payload jsonb not null,                       -- normalized CaseRecord
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_records (
  provider text not null,
  provider_record_id text not null,
  record_kind text not null,
  record_key text not null references public.cases(record_key) on delete cascade,
  source_url text,
  indexed_at timestamptz,
  retrieved_at timestamptz not null default now(),
  primary key (provider, record_kind, provider_record_id)
);
create index if not exists provider_records_key_idx on public.provider_records(record_key);

create table if not exists public.dockets (
  provider text not null,
  provider_docket_id text not null,
  record_key text not null references public.cases(record_key) on delete cascade,
  date_last_filing date,
  date_modified timestamptz,
  payload jsonb not null,
  refreshed_at timestamptz not null default now(),
  primary key (provider, provider_docket_id)
);

create table if not exists public.docket_entries (
  provider text not null,
  provider_entry_id text not null,
  provider_docket_id text not null,
  entry_number text,
  date_filed date,
  category text,
  description text not null,
  first_seen_at timestamptz not null default now(),
  primary key (provider, provider_entry_id)
);
create index if not exists docket_entries_docket_idx on public.docket_entries(provider, provider_docket_id, date_filed desc);

create table if not exists public.documents (
  provider text not null,
  provider_document_id text not null,
  provider_docket_id text,
  title text,
  document_number text,
  page_count integer,
  available boolean,
  source_url text,
  first_seen_at timestamptz not null default now(),
  primary key (provider, provider_document_id)
);

create table if not exists public.parties (
  id bigint generated always as identity primary key,
  record_key text not null references public.cases(record_key) on delete cascade,
  name text not null,
  role text,
  role_source text not null,
  is_organization boolean not null default false,
  provider_party_id text
);
create index if not exists parties_record_idx on public.parties(record_key);

create table if not exists public.attorneys (
  id bigint generated always as identity primary key,
  record_key text not null references public.cases(record_key) on delete cascade,
  name text not null,
  roles text[] not null default '{}',
  representing text[] not null default '{}',
  provider_attorney_id text
);
create index if not exists attorneys_record_idx on public.attorneys(record_key);

create table if not exists public.relationships (
  id bigint generated always as identity primary key,
  from_node text not null,                      -- e.g. "party:epic games inc"
  to_node text not null,                        -- e.g. "case:cand|20-cv-05640"
  relation text not null,                       -- party_to, represented_by, presided_over, ...
  record_key text references public.cases(record_key) on delete cascade,
  evidence text not null,                       -- human-readable source-backed evidence
  created_at timestamptz not null default now(),
  unique (from_node, to_node, relation, record_key)
);

create table if not exists public.provider_coverage (
  provider text not null,
  source text not null,
  label text not null,
  record_types text[] not null,
  jurisdictions text not null,
  date_coverage text,
  notes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (provider, source)
);

create table if not exists public.ai_briefs (
  record_key text not null,
  source_fingerprint text not null,             -- changes when underlying sources change
  model text not null,
  brief jsonb not null,
  created_at timestamptz not null default now(),
  primary key (record_key, source_fingerprint)
);

-- ---------------------------------------------------------------- research workspaces
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('entity','case','docket','filing','note','ai_summary','timeline_item','graph_view','search')),
  title text not null,
  ref jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists project_items_project_idx on public.project_items(project_id, created_at desc);

create table if not exists public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists saved_items_user_idx on public.saved_items(user_id, created_at desc);

-- ---------------------------------------------------------------- Case Radar
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('person','company','case','docket','attorney','law_firm','search')),
  label text not null,
  query jsonb not null default '{}'::jsonb,     -- {query, entityType, filters} or {provider, docketId}
  frequency text not null check (frequency in ('immediate','daily','weekly')),
  channels jsonb not null default '{"email": true, "in_app": true}'::jsonb,
  active boolean not null default true,
  provider_monitor_id text,
  last_checked_at timestamptz,
  last_digest_at timestamptz,
  seen_keys text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists watchlists_due_idx on public.watchlists(active, frequency, last_checked_at);

create table if not exists public.docket_snapshots (
  id bigint generated always as identity primary key,
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  provider text not null,
  provider_docket_id text not null,
  snapshot jsonb not null,                      -- metadata + entry ids + statuses
  taken_at timestamptz not null default now()
);
create index if not exists docket_snapshots_idx on public.docket_snapshots(watchlist_id, taken_at desc);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  watchlist_id uuid references public.watchlists(id) on delete set null,
  kind text not null check (kind in ('new_record','docket_diff','status_change','system')),
  title text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists alerts_user_idx on public.alerts(user_id, created_at desc);

-- ---------------------------------------------------------------- operational (service role only)
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  kind text not null,
  user_id uuid references public.profiles(id) on delete set null,
  subject_key text,
  provider text,
  status text,
  ms integer,
  quantity integer not null default 1,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_kind_idx on public.usage_events(kind, created_at desc);
create index if not exists usage_events_user_idx on public.usage_events(user_id, kind, created_at desc);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  name text not null,
  anon_id text,
  user_id uuid references public.profiles(id) on delete set null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_name_idx on public.analytics_events(name, created_at desc);

create table if not exists public.provider_cache (
  key text primary key,
  bucket text not null,
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists provider_cache_expiry_idx on public.provider_cache(expires_at);

create table if not exists public.budget_buckets (
  key text not null,
  hour_bucket timestamptz not null,
  amount integer not null default 0,
  primary key (key, hour_bucket)
);

create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

create table if not exists public.webhook_receipts (
  idempotency_key text primary key,
  source text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- functions
create or replace function public.budget_take(p_key text, p_amount integer, p_limit integer, p_window_hours integer)
returns table(allowed boolean, used integer)
language plpgsql security definer set search_path = public as $$
declare
  v_used integer;
  v_bucket timestamptz := date_trunc('hour', now());
begin
  perform pg_advisory_xact_lock(hashtext(p_key));
  select coalesce(sum(amount), 0) into v_used from budget_buckets
    where key = p_key and hour_bucket > now() - make_interval(hours => p_window_hours);
  if v_used + p_amount > p_limit then
    return query select false, v_used;
    return;
  end if;
  insert into budget_buckets(key, hour_bucket, amount) values (p_key, v_bucket, p_amount)
    on conflict (key, hour_bucket) do update set amount = budget_buckets.amount + excluded.amount;
  return query select true, v_used + p_amount;
end $$;

create or replace function public.budget_used(p_key text, p_window_hours integer)
returns integer language sql security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::integer from budget_buckets
  where key = p_key and hour_bucket > now() - make_interval(hours => p_window_hours);
$$;

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into rate_limits(key, window_start, hits) values (p_key, v_start, 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1
    returning hits into v_hits;
  return query select v_hits <= p_max, greatest(p_max - v_hits, 0), v_start + make_interval(secs => p_window_seconds);
end $$;

create or replace function public.usage_distinct_subjects(p_user uuid, p_kind text, p_since timestamptz)
returns integer language sql security definer set search_path = public as $$
  select count(distinct subject_key)::integer from usage_events
  where user_id = p_user and kind = p_kind and created_at >= p_since;
$$;

create or replace function public.is_project_member(p_project uuid, p_roles text[] default array['owner','editor','viewer'])
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from project_members m where m.project_id = p_project and m.user_id = auth.uid() and m.role = any(p_roles)
  ) or exists (select 1 from projects p where p.id = p_project and p.owner_id = auth.uid());
$$;

create or replace function public.purge_expired_cache() returns void
language sql security definer set search_path = public as $$
  delete from provider_cache where expires_at < now();
  delete from rate_limits where window_start < now() - interval '2 days';
  delete from budget_buckets where hour_bucket < now() - interval '3 days';
$$;

-- Only the service role may call operational functions.
revoke execute on function public.budget_take(text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.budget_used(text, integer) from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.usage_distinct_subjects(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.purge_expired_cache() from public, anon, authenticated;

-- ---------------------------------------------------------------- row-level security
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.searches enable row level security;
alter table public.search_results enable row level security;
alter table public.entities enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.identity_clusters enable row level security;
alter table public.identity_corrections enable row level security;
alter table public.courts enable row level security;
alter table public.cases enable row level security;
alter table public.provider_records enable row level security;
alter table public.dockets enable row level security;
alter table public.docket_entries enable row level security;
alter table public.documents enable row level security;
alter table public.parties enable row level security;
alter table public.attorneys enable row level security;
alter table public.relationships enable row level security;
alter table public.provider_coverage enable row level security;
alter table public.ai_briefs enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_items enable row level security;
alter table public.saved_items enable row level security;
alter table public.watchlists enable row level security;
alter table public.docket_snapshots enable row level security;
alter table public.alerts enable row level security;
alter table public.usage_events enable row level security;
alter table public.analytics_events enable row level security;
alter table public.provider_cache enable row level security;
alter table public.budget_buckets enable row level security;
alter table public.rate_limits enable row level security;
alter table public.webhook_receipts enable row level security;

-- Own profile
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Own subscriptions (read-only; written by the Stripe webhook with the service role)
create policy subscriptions_select_own on public.subscriptions for select using (user_id = auth.uid());

-- Own searches and results
create policy searches_all_own on public.searches for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy search_results_select_own on public.search_results for select
  using (exists (select 1 from public.searches s where s.id = search_id and s.user_id = auth.uid()));

-- Own identity work
create policy identity_clusters_all_own on public.identity_clusters for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy identity_corrections_all_own on public.identity_corrections for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Shared public-record caches: read-only for signed-in users
create policy entities_read on public.entities for select to authenticated using (true);
create policy entity_aliases_read on public.entity_aliases for select to authenticated using (true);
create policy courts_read on public.courts for select using (true);
create policy cases_read on public.cases for select to authenticated using (true);
create policy provider_records_read on public.provider_records for select to authenticated using (true);
create policy dockets_read on public.dockets for select to authenticated using (true);
create policy docket_entries_read on public.docket_entries for select to authenticated using (true);
create policy documents_read on public.documents for select to authenticated using (true);
create policy parties_read on public.parties for select to authenticated using (true);
create policy attorneys_read on public.attorneys for select to authenticated using (true);
create policy relationships_read on public.relationships for select to authenticated using (true);
create policy provider_coverage_read on public.provider_coverage for select using (true);

-- Projects: owner and members
create policy projects_select on public.projects for select using (public.is_project_member(id));
create policy projects_insert on public.projects for insert with check (owner_id = auth.uid());
create policy projects_update on public.projects for update using (public.is_project_member(id, array['owner','editor'])) with check (public.is_project_member(id, array['owner','editor']));
create policy projects_delete on public.projects for delete using (owner_id = auth.uid());

create policy project_members_select on public.project_members for select using (public.is_project_member(project_id));
create policy project_members_manage on public.project_members for all
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy project_items_select on public.project_items for select using (public.is_project_member(project_id));
create policy project_items_insert on public.project_items for insert
  with check (added_by = auth.uid() and public.is_project_member(project_id, array['owner','editor']));
create policy project_items_update on public.project_items for update
  using (public.is_project_member(project_id, array['owner','editor']));
create policy project_items_delete on public.project_items for delete
  using (public.is_project_member(project_id, array['owner','editor']));

-- Saved items, watchlists, alerts: own
create policy saved_items_all_own on public.saved_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy watchlists_all_own on public.watchlists for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy docket_snapshots_select_own on public.docket_snapshots for select
  using (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid()));
create policy alerts_select_own on public.alerts for select using (user_id = auth.uid());
create policy alerts_update_own on public.alerts for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ai_briefs, usage_events, analytics_events, provider_cache, budget_buckets, rate_limits,
-- stripe_events, webhook_receipts: no policies => only the service role can access them.

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
