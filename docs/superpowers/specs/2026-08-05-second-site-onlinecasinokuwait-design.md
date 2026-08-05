# Second Site: OnlineCasinoKuwait — Design

**Date:** 2026-08-05
**Status:** Approved, pending implementation
**Supersedes nothing.** Extends `2026-08-04-haz-reviews-dashboard-design.md`.

---

## 1. Why

The dashboard shipped on 2026-08-04 covers HAZREVIEWS.com only. The original
brief was for **one** dashboard covering **both** HAZREVIEWS.com and
OnlineCasinoKuwait — Ivan asked the client "separate or on one dashboard link?"
and Meny Monka answered "Yes, please! one". Ivan has since restated it: "those
two needs to have a dashboard as well."

So the remaining work is not a new app. It is introducing a **site axis** to the
existing one, so both properties live behind a single deployed link with a
switcher between them.

## 2. What is deliberately not changing

The existing keyword-group model stays exactly as it is. `RankingRecord` has no
`domain` field, and it should not gain one: with one site per snapshot the
domain column is constant and useless as an axis, which is why
`src/lib/groups.ts` groups *keywords* by the casino brand they target instead.
That reasoning holds just as well for two sites as for one.

Also unchanged: the parser, `normalize.ts`, `dates.ts`, `carryForward.ts`, the
auth and approval flow, and the RLS model. All 98 existing tests must still pass
untouched at the end of this work.

## 3. Where the site lives

**On `snapshots`, not on `ranking_records`.**

Every record in a snapshot belongs to exactly one site, because a snapshot is
one upload of one site's export on one date. Records therefore inherit their
site through `snapshot_id`. Putting a `site` column on `ranking_records` too
would denormalise it onto ~thousands of rows and create a second place for it to
go wrong.

```sql
alter table public.snapshots
  add column if not exists site text not null default 'hazreviews';
```

### Snapshot ids

Ids are currently `snap-<rawDate>`, deterministic so that re-uploading the same
date is an idempotent replace rather than a duplicate. With two sites that
collides: both could have a snapshot for 2026-08-05.

New format: **`snap-<siteId>-<rawDate>`**, still deterministic, now unique per
(site, date). Idempotent re-upload is preserved per site.

### Migration

`supabase/add-site-column.sql`, idempotent and safe to re-run, does three things
in one transaction:

1. Adds the `site` column with a `'hazreviews'` default, which backfills every
   existing row correctly, since everything currently stored is HAZREVIEWS data.
2. Rewrites existing ids from `snap-<date>` to `snap-hazreviews-<date>`, updating
   `ranking_records.snapshot_id` in step with `snapshots.id`. The FK is dropped
   and recreated around the rewrite because `ON DELETE CASCADE` does not cascade
   updates.
3. Adds `snapshots_site_raw_date_idx on (site, raw_date desc)` to serve the
   per-site recent-window query in §5.

Guarded by a `where id not like 'snap-hazreviews-%'` so a second run is a no-op.

## 4. The site registry

New `src/lib/sites.ts`, deliberately shaped like the existing group registry —
one array, everything else derived:

```ts
export interface Site {
  id: string        // 'hazreviews' — the stored value, never rendered
  name: string      // 'HAZREVIEWS'
  domain: string    // 'hazreviews.com'
  slug: string      // 'hazreviews' — URL segment
  color: string
}
```

Two entries. `SITES`, `SITE_BY_ID`, `SITE_BY_SLUG`, `DEFAULT_SITE_ID =
'hazreviews'`. Adding a third property later is one entry here and nothing else.

`site.id` is stored in the database and must never change once data exists;
`name` and `color` are presentation and can change freely. The test suite pins
the ids.

## 5. Reads become per-site

`loadRecentSnapshots(recentCount)` currently takes the newest 8 snapshots
overall. With two sites that starves one of them — eight consecutive HAZREVIEWS
uploads would leave Kuwait with no hydrated records at all, and the Kuwait view
would render as empty rather than as unloaded.

It becomes **newest `recentCount` per site**: `loadSnapshotMeta()` returns every
snapshot's `{id, rawDate, displayDate, site}`, the caller partitions by site,
slices each partition, and hydrates the union in the existing single paged
query. The 1000-row PostgREST paging in `loadSnapshotRecords` is unchanged — it
already takes an arbitrary id list, so it needs no site awareness at all.

`loadOlderSnapshots` likewise stays as-is; the caller already passes explicit
meta entries and now simply passes site-filtered ones.

## 6. Routing and app state

The active site is **URL state, not React state**, so a link to Kuwait is
shareable — which matters when the deliverable is a link handed to a client.

```
/                              → redirect to /hazreviews
/:siteSlug                     → Overview for that site
/:siteSlug/rankings            → group grid
/:siteSlug/rankings/:groupSlug → group detail matrix
/log            /how-it-works            /admin/users      → global, unprefixed
```

An unknown `:siteSlug` redirects to the default site rather than 404ing.

`AppState` keeps its single-`useState` shape. `snapshots` and `snapshotMeta`
hold **both** sites' data; the active site is read from the route and used to
filter in `Layout`'s existing `useMemo`. `activeSnapshotId` moves from a single
id to `Record<siteId, string | null>`, so switching sites does not silently
select a date that belongs to the other property.

`applyCarryForward` must run **per site**, not across the merged list. Carrying a
HAZREVIEWS search volume forward onto a Kuwait keyword would be a data
correctness bug, and it would be invisible in the UI.

## 7. UI

**Sidebar** gains a site switcher above the nav — the two sites with their
colour dot and name, active one highlighted. Nav links become site-relative.
`/log`, `/how-it-works` and `/admin/users` stay global.

**Overview and Rankings** are scoped to the active site and otherwise unchanged.
No combined cross-site view: the client asked to see both properties on one
dashboard, not to see them merged into one number, and averaging positions
across two unrelated properties would be meaningless.

**UploadModal** gains a target-site selector, defaulting to the currently active
site. This is the only place a site is chosen at write time, and the choice
determines the snapshot id. The existing duplicate-date warning becomes
per-site.

**Activity log** records which site an action affected through the existing
`section` field. No schema change.

## 8. Keyword groups stay shared

One `GROUPS` registry serving both sites, not one per site.

Group membership is *derived* by `groupForKeyword()` and never stored, so a
shared registry self-filters: a group with no matching keywords on the active
site simply does not render. Shared therefore costs nothing at the view layer
while keeping brands that appear on both properties — Rollero, FortunePlay,
PlayMojo — consistent in colour and alias handling. Two registries would create
a second place to fix the same alias bug.

Kuwait's own casino brands get appended to `GROUPS` as ordinary entries. Until
its keywords are seen, they fall through to `OTHER_GROUP`, which is the correct
and visible failure mode — not silent misclassification.

## 9. Error handling

Unchanged in shape. The one addition: a site with no snapshots yet renders the
existing empty state ("No data yet" + import prompt) scoped to that site, and
must be distinguishable from a failed load — `LoadError` already draws that
distinction and the site views inherit it.

## 10. Testing

Extending the existing suite; all 98 current tests keep passing.

- `sites.ts` — registry integrity: unique ids, unique slugs, `DEFAULT_SITE_ID`
  resolves, ids match the values the migration writes.
- Snapshot id derivation — `snap-<site>-<date>` round-trips, and two sites on the
  same date produce different ids.
- Per-site recent window — eight HAZREVIEWS snapshots plus one Kuwait snapshot
  still hydrates the Kuwait one.
- Per-site carry-forward — a value on one site never carries onto the other.

React components remain untested, consistent with the existing suite.

## 11. Open item

**Kuwait's brand seed list requires a real export.** The structural work in
§3–§7 does not depend on it and proceeds now. Seeding Kuwait's casino brands
into `GROUPS` is purely additive — one array entry per brand, no structural
change — and lands when a sample OnlineCasinoKuwait file is available.

The assumption on file format is that it matches the HAZREVIEWS flat export. If
it does not, the parser needs a second reader; that is contained to
`parser.ts` and does not affect anything else in this design.
