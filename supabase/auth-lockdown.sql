-- Haz Reviews Dashboard — lockdown migration.
--
-- Run after setup.sql. Idempotent; safe to re-run.
--
-- DEPARTURE from the sibling dashboards: reads require auth too, not just
-- writes. Those projects ship anon-open reads because they grew that way.
-- Nothing here is public, and one rule is easier to keep correct than two.

drop policy if exists "open snapshots" on public.snapshots;
drop policy if exists "open ranking_records" on public.ranking_records;

-- user_is_approved() is defined in setup.sql as SECURITY DEFINER. Re-declared
-- here so this migration also works when applied to a database whose setup
-- predates it.
create or replace function public.user_is_approved()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid() and status = 'approved'
  );
$$;

-- ─── snapshots ──────────────────────────────────────────────────────────────

drop policy if exists "approved read snapshots" on public.snapshots;
create policy "approved read snapshots" on public.snapshots
  for select to authenticated using (public.user_is_approved());

drop policy if exists "approved insert snapshots" on public.snapshots;
create policy "approved insert snapshots" on public.snapshots
  for insert to authenticated with check (public.user_is_approved());

drop policy if exists "approved update snapshots" on public.snapshots;
create policy "approved update snapshots" on public.snapshots
  for update to authenticated
  using (public.user_is_approved()) with check (public.user_is_approved());

drop policy if exists "approved delete snapshots" on public.snapshots;
create policy "approved delete snapshots" on public.snapshots
  for delete to authenticated using (public.user_is_approved());

-- ─── ranking_records ────────────────────────────────────────────────────────

drop policy if exists "approved read ranking_records" on public.ranking_records;
create policy "approved read ranking_records" on public.ranking_records
  for select to authenticated using (public.user_is_approved());

drop policy if exists "approved insert ranking_records" on public.ranking_records;
create policy "approved insert ranking_records" on public.ranking_records
  for insert to authenticated with check (public.user_is_approved());

drop policy if exists "approved update ranking_records" on public.ranking_records;
create policy "approved update ranking_records" on public.ranking_records
  for update to authenticated
  using (public.user_is_approved()) with check (public.user_is_approved());

drop policy if exists "approved delete ranking_records" on public.ranking_records;
create policy "approved delete ranking_records" on public.ranking_records
  for delete to authenticated using (public.user_is_approved());

-- ─── activity_log ───────────────────────────────────────────────────────────
-- Append-only by OMISSION: no update or delete policy exists for any role.
-- Insert additionally pins user_id to the caller, so nobody can forge an entry
-- attributed to someone else.

drop policy if exists "approved read activity_log" on public.activity_log;
create policy "approved read activity_log" on public.activity_log
  for select to authenticated using (public.user_is_approved());

drop policy if exists "approved insert activity_log" on public.activity_log;
create policy "approved insert activity_log" on public.activity_log
  for insert to authenticated
  with check (public.user_is_approved() and user_id = auth.uid());
