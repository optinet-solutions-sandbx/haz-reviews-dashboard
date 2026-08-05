-- Adds the site axis to an EXISTING Haz Reviews database.
--
-- Fresh installs get this from setup.sql and do not need to run this file.
-- Idempotent: safe to re-run, and a no-op on the second run.
--
-- Everything stored before this migration is HAZREVIEWS data, so the column
-- default backfills every existing row correctly.

begin;

-- ─── 1. The column ──────────────────────────────────────────────────────────

alter table public.snapshots
  add column if not exists site text not null default 'hazreviews';

-- ─── 2. Site-scope the existing ids ─────────────────────────────────────────
--
-- Ids move from 'snap-<date>' to 'snap-hazreviews-<date>'. The foreign key is
-- dropped and recreated around the rewrite because ON DELETE CASCADE does not
-- cascade UPDATEs — without this, renaming the parent orphans every child row.
--
-- Children are renamed BEFORE parents so no intermediate state references a
-- snapshot id that does not exist.

alter table public.ranking_records
  drop constraint if exists ranking_records_snapshot_id_fkey;

update public.ranking_records
   set snapshot_id = 'snap-hazreviews-' || substring(snapshot_id from 6)
 where snapshot_id like 'snap-%'
   and snapshot_id not like 'snap-hazreviews-%'
   and snapshot_id not like 'snap-onlinecasinokuwait-%';

update public.snapshots
   set id = 'snap-hazreviews-' || substring(id from 6)
 where id like 'snap-%'
   and id not like 'snap-hazreviews-%'
   and id not like 'snap-onlinecasinokuwait-%';

alter table public.ranking_records
  add constraint ranking_records_snapshot_id_fkey
  foreign key (snapshot_id) references public.snapshots(id) on delete cascade;

-- ─── 3. Index for the per-site recent window ────────────────────────────────

create index if not exists snapshots_site_raw_date_idx
  on public.snapshots (site, raw_date desc);

commit;

-- ─── Verification ───────────────────────────────────────────────────────────
-- Expect: every row 'hazreviews', and zero rows from the second query.

select site, count(*) from public.snapshots group by site;

select r.snapshot_id
  from public.ranking_records r
  left join public.snapshots s on s.id = r.snapshot_id
 where s.id is null
 limit 20;
