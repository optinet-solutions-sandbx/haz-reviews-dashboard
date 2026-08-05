-- Haz Reviews Dashboard — base schema.
--
-- Run this first on a fresh Supabase project, then auth-lockdown.sql.
-- Every statement is idempotent, so the whole file can be re-run safely.

-- ─── Snapshots ──────────────────────────────────────────────────────────────

create table if not exists public.snapshots (
  id            text primary key,   -- 'snap-<site>-<raw_date>', client-generated
  site          text not null default 'hazreviews',  -- a site id from lib/sites.ts
  raw_date      text not null,      -- 'YYYY-MM-DD'
  display_date  text not null,      -- re-derived on read; never trusted
  created_at    timestamptz not null default now()
);

-- Ordering is by the snapshot's own date, not by insert order: a backfill
-- writes newest-first, so created_at desc alone would surface the OLDEST
-- snapshot as "latest".
create index if not exists snapshots_raw_date_idx
  on public.snapshots (raw_date desc);

-- Serves the per-site recent window in storage.ts — each property gets its own
-- newest-N, so a busy site cannot starve a quiet one.
create index if not exists snapshots_site_raw_date_idx
  on public.snapshots (site, raw_date desc);

create table if not exists public.ranking_records (
  id            bigserial primary key,
  snapshot_id   text not null references public.snapshots(id) on delete cascade,
  keyword       text not null,
  market        text not null,
  -- TEXT, not int: the source vocabulary includes 'NR' and 'Not in top 100'.
  -- Normalisation happens at the view layer so nothing is destroyed here.
  position      text not null,
  previous      text not null default '',
  -- Verbatim source token. Deltas are computed separately by effectiveDelta().
  change        text not null default '',
  url_found     text not null default '',
  search_volume text not null default '',
  date          text not null default ''
);

create index if not exists ranking_records_snapshot_idx
  on public.ranking_records (snapshot_id);
-- Matches the updateRecordFields predicate exactly.
create index if not exists ranking_records_lookup_idx
  on public.ranking_records (snapshot_id, keyword, market);

-- ─── Access control ─────────────────────────────────────────────────────────

create table if not exists public.user_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  -- 'revoked' is a distinct third state, not a return to 'pending', so an admin
  -- who deliberately cut someone off never sees them again as a new signup.
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'revoked')),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ─── Audit log ──────────────────────────────────────────────────────────────

create table if not exists public.activity_log (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,
  email      text not null,
  action     text not null,   -- 'upload' | 'edit' | 'delete'
  section    text not null,
  summary    text not null
);
create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);

-- ─── Functions and triggers ─────────────────────────────────────────────────

-- Auto-provision an access row for every new auth user, so the admin queue is
-- populated without the app having to write it.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_access (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row
  execute function public.handle_new_user();

-- A policy ON user_access containing a bare
-- `exists (select ... from user_access ...)` re-triggers itself for every
-- scanned row, and Postgres raises 42P17 infinite recursion. SECURITY DEFINER
-- bypasses RLS internally, which is the only clean way out. The inline exists()
-- form is fine in policies on OTHER tables — only self-referential ones recurse.
create or replace function public.user_is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce(is_admin, false) from public.user_access where user_id = auth.uid();
$$;

create or replace function public.user_is_approved()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid() and status = 'approved'
  );
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.snapshots       enable row level security;
alter table public.ranking_records enable row level security;
alter table public.user_access      enable row level security;
alter table public.activity_log     enable row level security;

-- Permissive to start: get data flowing, then run auth-lockdown.sql.
drop policy if exists "open snapshots" on public.snapshots;
create policy "open snapshots" on public.snapshots
  for all using (true) with check (true);

drop policy if exists "open ranking_records" on public.ranking_records;
create policy "open ranking_records" on public.ranking_records
  for all using (true) with check (true);

drop policy if exists "self or admin read user_access" on public.user_access;
create policy "self or admin read user_access" on public.user_access
  for select using (user_id = auth.uid() or public.user_is_admin());

drop policy if exists "admin update user_access" on public.user_access;
create policy "admin update user_access" on public.user_access
  for update using (public.user_is_admin()) with check (public.user_is_admin());
