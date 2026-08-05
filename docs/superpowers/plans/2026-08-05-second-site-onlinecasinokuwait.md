# Second Site (OnlineCasinoKuwait) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second tracked property, OnlineCasinoKuwait, to the existing HAZREVIEWS dashboard so both live behind one deployed link with a switcher between them.

**Architecture:** A `site` column on `snapshots` (not on `ranking_records` — records inherit it via `snapshot_id`). Snapshot ids become `snap-<siteId>-<rawDate>`, keeping idempotent re-upload but now unique per site. The active site is URL state (`/:siteSlug/...`) so links are shareable. The keyword-group registry stays shared and self-filters, because group membership is derived rather than stored.

**Tech Stack:** React 19, TypeScript (strict), Vite 6, Tailwind v4, Supabase (PostgREST), vitest.

**Spec:** `docs/superpowers/specs/2026-08-05-second-site-onlinecasinokuwait-design.md`

## Global Constraints

- **No new npm dependencies.** Everything here is achievable with what is installed.
- **All 98 existing tests must still pass at the end of every task.** Run `npm test`, not just the new file.
- **`npm run build` must stay clean.** TypeScript is strict; `tsc -b` runs as part of the build.
- **Never hard-code hex colours in components.** Use the CSS variables defined in `src/index.css` (`var(--muted)`, `var(--page)`, …). Site accent colours are the one exception: they live in the site registry and are passed as inline `style` values, exactly as group colours already are.
- **`site.id` values are stored in the database.** Once data exists they must never change. The two ids are exactly `'hazreviews'` and `'onlinecasinokuwait'`.
- **Records never gain a `site` field.** If you find yourself adding one, re-read §3 of the spec.
- **Work on branch `feat/second-site-kuwait`.** Do not commit to `master`.
- Comments explain *why*, not *what* — match the density and voice of the surrounding code.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/lib/sites.ts` | Create | The site registry. One array, everything else derived. |
| `src/lib/sites.test.ts` | Create | Registry integrity: unique ids/slugs, default resolves. |
| `src/types/index.ts` | Modify | `site` on `Snapshot`/`SnapshotMeta`; `AppState.activeSnapshotIdBySite`; `HzOutletContext.activeSite`. |
| `src/lib/parser.ts` | Modify | `snapshotIdFor(siteId, rawDate)`; `parseRows(rows, siteId)`. |
| `src/lib/readWorkbook.ts` | Modify | `parseSheet(buffer, siteId)` — the xlsx boundary, kept separate for code-splitting. |
| `src/lib/parser.test.ts` | Modify | Update call sites; add per-site id cases. |
| `src/lib/carryForward.ts` | Modify | Partition by site before walking. |
| `src/lib/carryForward.test.ts` | Modify | Add cross-site isolation case. |
| `src/lib/storage.ts` | Modify | Read/write the `site` column; per-site recent window. |
| `src/lib/storage.test.ts` | Modify | Add per-site window cases. |
| `supabase/add-site-column.sql` | Create | Idempotent migration for the deployed database. |
| `supabase/setup.sql` | Modify | Fresh installs get the column from the start. |
| `src/App.tsx` | Modify | Site-prefixed routes; per-site active snapshot; site-aware titles. |
| `src/components/Sidebar.tsx` | Modify | Site switcher; site-relative nav links. |
| `src/components/UploadModal.tsx` | Modify | Target-site selector. |
| `src/pages/HowItWorks.tsx` | Modify | Document the switcher; de-hardcode "hazreviews.com". |

---

## Task 1: The site registry

**Files:**
- Create: `src/lib/sites.ts`
- Test: `src/lib/sites.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Site` interface; `SITES: Site[]`; `SITE_BY_ID: Map<string, Site>`; `SITE_BY_SLUG: Map<string, Site>`; `DEFAULT_SITE_ID: string`; `siteById(id: string): Site`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sites.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_ID, SITES, SITE_BY_ID, SITE_BY_SLUG, siteById } from './sites'

describe('site registry', () => {
  it('contains both tracked properties', () => {
    expect(SITES.map((s) => s.id).sort()).toEqual(['hazreviews', 'onlinecasinokuwait'])
  })

  // These ids are written into the database. Changing one silently orphans
  // every snapshot already stored under the old value.
  it('pins the stored ids', () => {
    expect(SITE_BY_ID.get('hazreviews')?.domain).toBe('hazreviews.com')
    expect(SITE_BY_ID.get('onlinecasinokuwait')?.domain).toBe('onlinecasinokuwait.com')
  })

  it('has unique ids and slugs', () => {
    expect(new Set(SITES.map((s) => s.id)).size).toBe(SITES.length)
    expect(new Set(SITES.map((s) => s.slug)).size).toBe(SITES.length)
  })

  it('resolves the default site', () => {
    expect(SITE_BY_ID.get(DEFAULT_SITE_ID)).toBeDefined()
    expect(DEFAULT_SITE_ID).toBe('hazreviews')
  })

  it('looks up by slug', () => {
    expect(SITE_BY_SLUG.get('kuwait')?.id).toBe('onlinecasinokuwait')
  })

  // An unknown id must not crash a render deep in the tree.
  it('falls back to the default for an unknown id', () => {
    expect(siteById('nope').id).toBe(DEFAULT_SITE_ID)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/lib/sites.test.ts`
Expected: FAIL — `Failed to resolve import "./sites"`.

- [ ] **Step 3: Implement `src/lib/sites.ts`**

```ts
/**
 * THE SITE REGISTRY — the single source of truth for tracked properties.
 *
 * `id` is written into snapshots.site and into every snapshot id. Once data
 * exists it can never change without a migration. `name`, `domain` and `color`
 * are presentation and can change freely.
 *
 * `slug` is the URL segment. It is deliberately separate from `id` so a long
 * stored id can have a short, typeable URL ('onlinecasinokuwait' → 'kuwait')
 * without touching stored data.
 *
 * Adding a third property is one entry here and nothing else.
 */
export interface Site {
  id: string
  name: string
  domain: string
  slug: string
  color: string
}

export const SITES: Site[] = [
  {
    id: 'hazreviews',
    name: 'HAZREVIEWS',
    domain: 'hazreviews.com',
    slug: 'hazreviews',
    color: '#2F6FED',
  },
  {
    id: 'onlinecasinokuwait',
    name: 'OnlineCasinoKuwait',
    domain: 'onlinecasinokuwait.com',
    slug: 'kuwait',
    color: '#12A150',
  },
]

export const DEFAULT_SITE_ID = 'hazreviews'

export const SITE_BY_ID = new Map(SITES.map((s) => [s.id, s]))
export const SITE_BY_SLUG = new Map(SITES.map((s) => [s.slug, s]))

/**
 * Never throws. A stored id that is no longer in the registry — or a typo in a
 * URL — resolves to the default rather than crashing a render deep in the tree.
 */
export function siteById(id: string): Site {
  return SITE_BY_ID.get(id) ?? SITE_BY_ID.get(DEFAULT_SITE_ID)!
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/sites.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sites.ts src/lib/sites.test.ts
git commit -m "feat(sites): add the site registry for HAZREVIEWS and OnlineCasinoKuwait"
```

---

## Task 2: Types carry the site

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: nothing at runtime.
- Produces: `Snapshot.site: string`; `SnapshotMeta.site: string`; `AppState.activeSnapshotIdBySite: Record<string, string | null>`; `HzOutletContext.activeSite: Site`, `HzOutletContext.activeSnapshotId: string | null` (unchanged name, now derived per site).

This task intentionally breaks the build. Task 3 onward repairs it. Do not try to
fix every error here — only edit `src/types/index.ts`.

- [ ] **Step 1: Add `site` to `Snapshot` and `SnapshotMeta`**

In `src/types/index.ts`, change the two interfaces:

```ts
export interface Snapshot {
  /** 'snap-<siteId>-<rawDate>' — deterministic, which is what makes upsert
   *  idempotent, and site-scoped so two properties can share a date. */
  id: string
  /** A site id from the registry in lib/sites.ts. Stored, so never renamed. */
  site: string
  rawDate: string
  /** e.g. '4 Aug 26'. Re-derived from rawDate on read, never trusted. */
  displayDate: string
  records: RankingRecord[]
}

export interface SnapshotMeta {
  id: string
  site: string
  rawDate: string
  displayDate: string
}
```

- [ ] **Step 2: Make the active snapshot per-site in `AppState`**

Replace the `activeSnapshotId` field:

```ts
export interface AppState {
  /** Hydrated: the recent window plus any older snapshots loaded on demand.
   *  Holds BOTH sites; views filter by the active one. */
  snapshots: Snapshot[]
  /** Every snapshot that exists, metadata only. Both sites. */
  snapshotMeta: SnapshotMeta[]
  /**
   * Keyed by site id — null means "the most recent for that site".
   *
   * A single shared id would leak across the switcher: selecting an August date
   * on HAZREVIEWS and then switching to Kuwait would look up an id that belongs
   * to the other property, silently falling back to Kuwait's latest while the
   * date tab bar still highlighted August.
   */
  activeSnapshotIdBySite: Record<string, string | null>
}
```

- [ ] **Step 3: Add the active site to the outlet context**

Add the import at the top of the file:

```ts
import type { Site } from '../lib/sites'
```

Then in `HzOutletContext`, immediately above `snapshots`:

```ts
  /** Read from the URL, not from state — so a link to a site is shareable. */
  activeSite: Site
  /** Carry-forward APPLIED, and FILTERED to activeSite. */
  snapshots: Snapshot[]
  /** Metadata for activeSite only. */
  snapshotMeta: SnapshotMeta[]
```

Leave `activeSnapshotId: string | null` and `onSelectSnapshot` as they are — pages
keep the same contract; `Layout` now resolves them per site.

- [ ] **Step 4: Confirm the expected breakage**

Run: `npx tsc -b`
Expected: FAIL, with errors in `parser.ts`, `storage.ts` and `App.tsx` about the
missing `site` property and the removed `activeSnapshotId` field. This is correct
— those are Tasks 3, 5 and 7.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add site to Snapshot, SnapshotMeta and app state"
```

---

## Task 3: Site-scoped snapshot ids

**Files:**
- Modify: `src/lib/parser.ts:24-26`, `src/lib/parser.ts:108`, `src/lib/parser.ts:167-198`
- Test: `src/lib/parser.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SITE_ID` from `./sites`.
- Produces: `snapshotIdFor(siteId: string, rawDate: string): string`; `parseRows(rows: unknown[][], siteId: string): ParseResult`; `withSnapshotDate(result: ParseResult, rawDate: string): ParseResult` (signature unchanged — it reads the site off `result.snapshot.site`).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/parser.test.ts`, inside the existing top-level `describe`:

```ts
  describe('site scoping', () => {
    const ROWS: unknown[][] = [
      ['Keyword', 'Market', 'Position', 'Previous', 'Change', 'URL', 'Volume', 'Date'],
      ['rabona casino', 'KW', '4', '6', '+2', 'https://x/y', '1.2K', '2026-08-05'],
    ]

    it('stamps the snapshot with the requested site', () => {
      expect(parseRows(ROWS, 'onlinecasinokuwait').snapshot.site).toBe('onlinecasinokuwait')
    })

    // Without this, the two properties collide on any shared date and the
    // second upload silently replaces the first.
    it('gives the same date on different sites different ids', () => {
      const haz = parseRows(ROWS, 'hazreviews').snapshot.id
      const kw = parseRows(ROWS, 'onlinecasinokuwait').snapshot.id
      expect(haz).not.toBe(kw)
      expect(haz).toBe('snap-hazreviews-2026-08-05')
      expect(kw).toBe('snap-onlinecasinokuwait-2026-08-05')
    })

    it('keeps the site when the date is overridden', () => {
      const result = withSnapshotDate(parseRows(ROWS, 'onlinecasinokuwait'), '2026-07-01')
      expect(result.snapshot.site).toBe('onlinecasinokuwait')
      expect(result.snapshot.id).toBe('snap-onlinecasinokuwait-2026-07-01')
    })
  })
```

Make sure `withSnapshotDate` is in the file's import list from `./parser`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/parser.test.ts`
Expected: FAIL — `parseRows` takes one argument, and `snapshot.site` is undefined.

- [ ] **Step 3: Implement the change**

In `src/lib/parser.ts`, add to the imports:

```ts
import { DEFAULT_SITE_ID } from './sites'
```

Replace `snapshotIdFor` (line 24):

```ts
/**
 * Deterministic and site-scoped, which is what makes re-upload an idempotent
 * replace instead of a duplicate — and what stops two properties sharing a date
 * from overwriting each other.
 */
export function snapshotIdFor(siteId: string, rawDate: string): string {
  return `snap-${siteId}-${rawDate}`
}
```

Change the `parseRows` signature (line 108). The default keeps every existing
call site and test compiling unchanged:

```ts
export function parseRows(rows: unknown[][], siteId: string = DEFAULT_SITE_ID): ParseResult {
```

Change the returned snapshot literal (line 168):

```ts
    snapshot: {
      id: snapshotIdFor(siteId, detectedDate),
      site: siteId,
      rawDate: detectedDate,
      displayDate: formatDisplayDate(detectedDate),
      records,
    },
```

Change the id line inside `withSnapshotDate` (line 194) — it reads the site from
the snapshot it was handed, so its own signature does not change:

```ts
      id: snapshotIdFor(result.snapshot.site, rawDate),
```

- [ ] **Step 4: Thread the site through `parseSheet`**

`parseSheet` lives in `src/lib/readWorkbook.ts`, not in `parser.ts` — that split
is deliberate, because `readWorkbook.ts` is the only module importing the ~600 kB
`xlsx` package and the upload modal loads it with a dynamic import. Keep the
split; only add the parameter.

Change the signature and the delegating call:

```ts
import { DEFAULT_SITE_ID } from './sites'

export function parseSheet(
  buffer: ArrayBuffer,
  siteId: string = DEFAULT_SITE_ID,
): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file contains no sheets.')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: '',
  })
  return parseRows(rows, siteId)
}
```

Do not import anything else from `parser.ts` here — `readWorkbook.ts` must stay a
thin boundary so the code-split holds.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/parser.test.ts`
Expected: PASS, including all pre-existing cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/parser.ts src/lib/parser.test.ts
git commit -m "feat(parser): scope snapshot ids by site"
```

---

## Task 4: Carry-forward stops at the site boundary

**Files:**
- Modify: `src/lib/carryForward.ts:20-52`
- Test: `src/lib/carryForward.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `applyCarryForward<T extends { site: string; rawDate: string; records: RankingRecord[] }>(snapshots: T[]): T[]`.

Carrying a HAZREVIEWS search volume onto a Kuwait keyword would be a silent data
correctness bug — the number would look real and there would be nothing on screen
to suggest it came from the other property.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/carryForward.test.ts`:

```ts
  it('never carries a volume across sites', () => {
    const rec = (keyword: string, searchVolume: string): RankingRecord => ({
      keyword,
      market: 'KW',
      position: '5',
      previous: '5',
      change: '0',
      urlFound: '',
      searchVolume,
      date: '',
    })

    const result = applyCarryForward([
      { site: 'hazreviews', rawDate: '2026-08-01', records: [rec('rabona casino', '9.9K')] },
      { site: 'onlinecasinokuwait', rawDate: '2026-08-02', records: [rec('rabona casino', '')] },
    ])

    // Same keyword, same market, later date — but a different property.
    expect(result[1].records[0].searchVolume).toBe('')
  })

  it('still carries forward within one site', () => {
    const rec = (searchVolume: string): RankingRecord => ({
      keyword: 'rabona casino',
      market: 'KW',
      position: '5',
      previous: '5',
      change: '0',
      urlFound: '',
      searchVolume,
      date: '',
    })

    const result = applyCarryForward([
      { site: 'onlinecasinokuwait', rawDate: '2026-08-01', records: [rec('9.9K')] },
      { site: 'onlinecasinokuwait', rawDate: '2026-08-02', records: [rec('')] },
    ])

    expect(result[1].records[0].searchVolume).toBe('9.9K')
  })
```

Existing tests in this file construct snapshots without a `site`. Add
`site: 'hazreviews',` to each of those literals so the file type-checks.

- [ ] **Step 2: Run the tests and confirm the cross-site one fails**

Run: `npx vitest run src/lib/carryForward.test.ts`
Expected: FAIL on "never carries a volume across sites" — it returns `'9.9K'`.

- [ ] **Step 3: Implement the change**

In `src/lib/carryForward.ts`, widen the constraint and give each site its own
volume map. Replace the function body:

```ts
export function applyCarryForward<
  T extends { site: string; rawDate: string; records: RankingRecord[] },
>(snapshots: T[]): T[] {
  if (snapshots.length === 0) return []

  // Oldest → newest for the walk, without disturbing the caller's order.
  const ascending = [...snapshots].sort((a, b) => a.rawDate.localeCompare(b.rawDate))

  // One map PER SITE. A single shared map would inherit a HAZREVIEWS volume
  // onto an identically-named Kuwait keyword — a wrong number that looks
  // entirely plausible on screen.
  const volumesBySite = new Map<string, Map<string, string>>()
  const filledByIndex = new Map<T, RankingRecord[]>()

  for (const snapshot of ascending) {
    let volumes = volumesBySite.get(snapshot.site)
    if (!volumes) {
      volumes = new Map<string, string>()
      volumesBySite.set(snapshot.site, volumes)
    }

    const records = snapshot.records.map((r) => {
      const k = recordKey(r)

      // Seed from the record's OWN value first, so a cleared value stops
      // propagating rather than being overwritten by its own inheritance.
      if (r.searchVolume.trim() !== '') {
        volumes.set(k, r.searchVolume)
        return r
      }

      const inherited = volumes.get(k)
      return inherited ? { ...r, searchVolume: inherited } : r
    })

    // Keyed by object identity: two snapshots on different sites can share a
    // date, so there is no value-based key that is guaranteed unique.
    filledByIndex.set(snapshot, records)
  }

  return snapshots.map((s) => ({ ...s, records: filledByIndex.get(s) ?? s.records }))
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/carryForward.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/carryForward.ts src/lib/carryForward.test.ts
git commit -m "fix(carry-forward): partition inheritance by site"
```

---

## Task 5: Storage reads and writes the site

**Files:**
- Modify: `src/lib/storage.ts:44-50`, `:108-118`, `:169-185`, `:201-223`
- Test: `src/lib/storage.test.ts`

**Interfaces:**
- Consumes: `SITES` from `./sites`; `Snapshot`, `SnapshotMeta` from `../types`.
- Produces: `toSnapshotMeta(row: { id: string; site: string | null; raw_date: string }): SnapshotMeta`; `recentPerSite(meta: SnapshotMeta[], perSite: number): SnapshotMeta[]`; `loadRecentSnapshots(recentCount?: number)` (signature unchanged, semantics now per-site).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/storage.test.ts`:

```ts
import { recentPerSite, toSnapshotMeta } from './storage'

describe('recentPerSite', () => {
  const meta = (site: string, rawDate: string): SnapshotMeta => ({
    id: `snap-${site}-${rawDate}`,
    site,
    rawDate,
    displayDate: rawDate,
  })

  // The bug this exists to prevent: eight consecutive HAZREVIEWS uploads used to
  // consume the whole window, so Kuwait hydrated zero records and its page
  // rendered as "no data yet" rather than as unloaded.
  it('gives every site its own window', () => {
    const all = [
      ...Array.from({ length: 8 }, (_, i) => meta('hazreviews', `2026-08-0${8 - i}`)),
      meta('onlinecasinokuwait', '2026-07-01'),
    ]
    const picked = recentPerSite(all, 8)
    expect(picked.filter((m) => m.site === 'onlinecasinokuwait')).toHaveLength(1)
    expect(picked.filter((m) => m.site === 'hazreviews')).toHaveLength(8)
  })

  it('caps each site independently', () => {
    const all = [
      meta('hazreviews', '2026-08-03'),
      meta('hazreviews', '2026-08-02'),
      meta('hazreviews', '2026-08-01'),
      meta('onlinecasinokuwait', '2026-08-03'),
      meta('onlinecasinokuwait', '2026-08-02'),
    ]
    const picked = recentPerSite(all, 2)
    expect(picked).toHaveLength(4)
    expect(picked.filter((m) => m.site === 'hazreviews').map((m) => m.rawDate)).toEqual([
      '2026-08-03',
      '2026-08-02',
    ])
  })

  it('returns an empty list for empty input', () => {
    expect(recentPerSite([], 8)).toEqual([])
  })
})

describe('toSnapshotMeta', () => {
  // Rows written before the migration have a null site. They are all HAZREVIEWS
  // data, and must not read as a site the registry does not know.
  it('defaults a null site to hazreviews', () => {
    expect(toSnapshotMeta({ id: 'snap-2026-08-01', site: null, raw_date: '2026-08-01' }).site).toBe(
      'hazreviews',
    )
  })
})
```

Add `SnapshotMeta` to the file's type imports if it is not already there.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: FAIL — `recentPerSite` is not exported.

- [ ] **Step 3: Implement the change**

In `src/lib/storage.ts`, add to the imports:

```ts
import { DEFAULT_SITE_ID } from './sites'
```

Replace `toSnapshotMeta` (line 44):

```ts
export function toSnapshotMeta(row: {
  id: string
  site: string | null
  raw_date: string
}): SnapshotMeta {
  return {
    id: row.id,
    // Null means the row predates the site column. Everything stored before the
    // migration is HAZREVIEWS data.
    site: row.site ?? DEFAULT_SITE_ID,
    rawDate: row.raw_date,
    displayDate: formatDisplayDate(row.raw_date),
  }
}
```

Add `recentPerSite` just below it:

```ts
/**
 * The newest `perSite` snapshots FOR EACH site, preserving the input's
 * newest-first ordering.
 *
 * Slicing the merged list instead would let a busy property starve a quiet one:
 * eight consecutive HAZREVIEWS uploads would consume the entire window and
 * Kuwait would hydrate nothing, rendering as "no data yet" when it has data.
 */
export function recentPerSite(meta: SnapshotMeta[], perSite: number): SnapshotMeta[] {
  const seen = new Map<string, number>()
  return meta.filter((m) => {
    const n = seen.get(m.site) ?? 0
    if (n >= perSite) return false
    seen.set(m.site, n + 1)
    return true
  })
}
```

Update the select in `loadSnapshotMeta` (line 111) to fetch the column:

```ts
    .select('id, site, raw_date')
```

Update `loadRecentSnapshots` (line 169) to use the per-site window:

```ts
export async function loadRecentSnapshots(
  recentCount: number = DEFAULT_RECENT,
): Promise<{ meta: SnapshotMeta[]; snapshots: Snapshot[] }> {
  const meta = await loadSnapshotMeta()
  const recent = recentPerSite(meta, recentCount)
  const records = await loadSnapshotRecords(recent.map((m) => m.id))
  return {
    meta,
    snapshots: recent.map((m) => ({ ...m, records: records.get(m.id) ?? [] })),
  }
}
```

Update the insert in `upsertSnapshot` (line 211):

```ts
  const insSnap = await supabase.from('snapshots').insert({
    id: snapshot.id,
    site: snapshot.site,
    raw_date: snapshot.rawDate,
    display_date: snapshot.displayDate,
  })
```

`loadSnapshotRecords`, `loadOlderSnapshots`, `deleteSnapshot` and
`updateRecordFields` need no change — they all operate on explicit snapshot ids,
which are already site-scoped.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat(storage): persist the site column and window snapshots per site"
```

---

## Task 6: Database migration

**Files:**
- Create: `supabase/add-site-column.sql`
- Modify: `supabase/setup.sql:8-19`

There are no automated tests for SQL in this project. Verification is running the
script against the Supabase SQL editor and confirming the checks at the end
return the expected rows.

- [ ] **Step 1: Write `supabase/add-site-column.sql`**

```sql
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
-- Expect: every row 'hazreviews', and zero rows in the second query.

select site, count(*) from public.snapshots group by site;

select r.snapshot_id
  from public.ranking_records r
  left join public.snapshots s on s.id = r.snapshot_id
 where s.id is null
 limit 20;
```

- [ ] **Step 2: Update `supabase/setup.sql` so fresh installs match**

In the `create table if not exists public.snapshots (...)` block, add the column
after `id`:

```sql
  id            text primary key,   -- 'snap-<site>-<raw_date>', client-generated
  site          text not null default 'hazreviews',  -- a site id from lib/sites.ts
```

And add the index next to `snapshots_raw_date_idx`:

```sql
create index if not exists snapshots_site_raw_date_idx
  on public.snapshots (site, raw_date desc);
```

- [ ] **Step 3: Verify by inspection**

Read both files start to finish. Confirm: the migration is wrapped in a
transaction, both `update` statements carry the `not like` guards that make a
second run a no-op, and the FK is recreated with `on delete cascade`.

Do not run this against the production database as part of this task — Task 10
covers deployment.

- [ ] **Step 4: Commit**

```bash
git add supabase/add-site-column.sql supabase/setup.sql
git commit -m "feat(db): add the site column with an idempotent migration"
```

---

## Task 7: Site-prefixed routing and per-site state

**Files:**
- Modify: `src/App.tsx:52-100`, `:125-146`, `:188-215`, `:224-245`, `:273-284`, `:299-318`, `:356-373`, `:398-441`

**Interfaces:**
- Consumes: `SITE_BY_SLUG`, `SITES`, `DEFAULT_SITE_ID`, `siteById` from `./lib/sites`.
- Produces: routes `/:siteSlug`, `/:siteSlug/rankings`, `/:siteSlug/rankings/:groupSlug`; `HzOutletContext.activeSite` populated; `snapshots` and `snapshotMeta` filtered to the active site.

This is the largest task. Work through it in order; the build stays broken until
Step 6.

- [ ] **Step 1: Add the imports and site-aware titles**

At the top of `src/App.tsx`:

```ts
import { Navigate, Outlet, Route, Routes, useLocation, useOutletContext, useParams } from 'react-router-dom'
import { DEFAULT_SITE_ID, SITES, SITE_BY_SLUG, siteById, type Site } from './lib/sites'
```

Replace the `SECTION_TITLES` / `DEFAULT_TITLE` block (lines 52-59). Titles are now
a function of the active site, so the domain is never hard-coded:

```ts
/** Keyed by the path segment AFTER the site slug. */
const SECTION_TITLES: Record<string, [string, string]> = {
  rankings: ['Rankings', 'Keyword positions'],
  log: ['Activity Log', 'Who changed what, and when'],
  'how-it-works': ['How It Works', 'A quick guide to using the dashboard'],
  'admin/users': ['Users', 'Access and approvals'],
}

function titleFor(pathname: string, site: Site): [string, string] {
  const rest = pathname.split('/').filter(Boolean)
  // Drop the site slug when it is present, so both '/hazreviews/rankings' and
  // the global '/log' resolve against the same table.
  if (rest[0] && SITE_BY_SLUG.has(rest[0])) rest.shift()
  const key = Object.keys(SECTION_TITLES).find((k) => rest.join('/').startsWith(k))
  if (!key) return [site.name, `Command center · ${site.domain}`]
  const [title, subtitle] = SECTION_TITLES[key]
  return [title, key === 'rankings' ? `${subtitle} for ${site.domain}` : subtitle]
}
```

- [ ] **Step 2: Rewrite the route table**

Replace the `<Routes>` block inside `App()`:

```tsx
      <Routes>
        <Route element={<Layout />}>
          {/* Site-scoped. The slug is the first segment so a link to a
              property is shareable. */}
          <Route
            path=":siteSlug"
            element={
              <RankingGate>
                <Home />
              </RankingGate>
            }
          />
          <Route
            path=":siteSlug/rankings"
            element={
              <RankingGate>
                <Rankings />
              </RankingGate>
            }
          />
          <Route
            path=":siteSlug/rankings/:groupSlug"
            element={
              <RankingGate>
                <Rankings />
              </RankingGate>
            }
          />
          {/* Global — not scoped to a property, and with their own data
              sources, so they must not wait on a large ranking fetch. */}
          <Route path="log" element={<Log />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="admin/users" element={<AdminUsers />} />
          <Route path="*" element={<Navigate to={`/${DEFAULT_SITE_ID}`} replace />} />
        </Route>
      </Routes>
```

The catch-all handles both `/` and an unknown slug, so a typo lands on the
default site rather than a 404.

- [ ] **Step 3: Resolve the active site inside `Layout`**

`Layout` renders above the route params, so `useParams` will not see `:siteSlug`.
Read it from the location instead. Add this just below `const location = useLocation()`:

```ts
  // Parsed from the path rather than useParams: Layout is the parent of the
  // routes that declare :siteSlug, so the param is not in scope here.
  const activeSite = useMemo(() => {
    const first = location.pathname.split('/').filter(Boolean)[0]
    return first ? (SITE_BY_SLUG.get(first) ?? siteById(DEFAULT_SITE_ID)) : siteById(DEFAULT_SITE_ID)
  }, [location.pathname])
```

- [ ] **Step 4: Switch state to a per-site active snapshot**

Replace the `useState<AppState>` initialiser (line 129):

```ts
  const [state, setState] = useState<AppState>({
    snapshots: [],
    snapshotMeta: [],
    activeSnapshotIdBySite: {},
  })
```

Update the initial-load `setState` (line 169):

```ts
        setState({ snapshotMeta: meta, snapshots, activeSnapshotIdBySite: {} })
```

- [ ] **Step 5: Filter the derived views by site**

Replace the `viewSnapshots` memo (line 195) and add site-filtered derivations:

```ts
  // Carry-forward runs across BOTH sites — applyCarryForward partitions
  // internally — then the view narrows to the active one.
  const viewSnapshots = useMemo(() => applyCarryForward(state.snapshots), [state.snapshots])

  const siteSnapshots = useMemo(
    () => viewSnapshots.filter((s) => s.site === activeSite.id),
    [viewSnapshots, activeSite.id],
  )

  const siteMeta = useMemo(
    () => state.snapshotMeta.filter((m) => m.site === activeSite.id),
    [state.snapshotMeta, activeSite.id],
  )

  const activeSnapshotId = state.activeSnapshotIdBySite[activeSite.id] ?? null
```

Update `groupsWithData` (line 203) to read the site-filtered list:

```ts
  const groupsWithData = useMemo(() => {
    const active = siteSnapshots.find((s) => s.id === activeSnapshotId) ?? siteSnapshots[0]
    if (!active) return []
    const present = new Set(active.records.map((r) => groupForKeyword(r.keyword).name))
    return [...GROUPS, OTHER_GROUP].filter((g) => present.has(g.name))
  }, [siteSnapshots, activeSnapshotId])
```

Replace the title memo (line 211):

```ts
  const [title, subtitle] = useMemo(
    () => titleFor(location.pathname, activeSite),
    [location.pathname, activeSite],
  )
```

- [ ] **Step 6: Repair the state writers**

In `persistOneSnapshot` (line 232), the meta entry now needs the site:

```ts
          const meta = [
            ...prev.snapshotMeta.filter((m) => m.id !== snapshot.id),
            {
              id: snapshot.id,
              site: snapshot.site,
              rawDate: snapshot.rawDate,
              displayDate: snapshot.displayDate,
            },
          ].sort((a, b) => b.rawDate.localeCompare(a.rawDate))
```

In `handleDeleteSnapshot` (line 309), clear the selection for the right site only:

```ts
      setState((prev) => ({
        ...prev,
        snapshots: prev.snapshots.filter((s) => s.id !== id),
        snapshotMeta: prev.snapshotMeta.filter((m) => m.id !== id),
        activeSnapshotIdBySite: Object.fromEntries(
          Object.entries(prev.activeSnapshotIdBySite).map(([site, active]) => [
            site,
            active === id ? null : active,
          ]),
        ),
      }))
```

In `handleLoadOlder` (line 360), only fetch older snapshots for the active site —
otherwise the button on one property silently pulls the other property's history:

```ts
      const loadedIds = new Set(state.snapshots.map((s) => s.id))
      const next = state.snapshotMeta
        .filter((m) => m.site === activeSite.id && !loadedIds.has(m.id))
        .slice(0, DEFAULT_RECENT)
```

Add `activeSite.id` to that callback's dependency array.

- [ ] **Step 7: Update the outlet context**

In the `context` memo (line 398), swap the three data fields and add the site:

```ts
      activeSite,
      snapshots: siteSnapshots,
      snapshotMeta: siteMeta,
      activeSnapshotId,
      onSelectSnapshot: (id) =>
        setState((prev) => ({
          ...prev,
          activeSnapshotIdBySite: { ...prev.activeSnapshotIdBySite, [activeSite.id]: id },
        })),
```

Update the dependency array: replace `viewSnapshots`, `state.snapshotMeta` and
`state.activeSnapshotId` with `siteSnapshots`, `siteMeta`, `activeSnapshotId` and
`activeSite`.

Also update `latestDate` (line 441) so the sidebar's "last updated" reflects the
active property:

```ts
  const latestDate = siteMeta[0]?.displayDate ?? null
```

- [ ] **Step 8: Tag activity-log entries with the property**

With two properties in one log, "Deleted snapshot 4 Aug 26" is ambiguous — there
can be two. The existing `section` column already carries free text, so no schema
change is needed.

There are three `logActivity` call sites in this file. Change the second argument
of each from `'rankings'` to a site-qualified section.

In `commitImport`:

```ts
      void logActivity(
        'upload',
        `rankings:${result.snapshot.site}`,
        `Imported ${result.snapshot.records.length.toLocaleString()} records · ${groups.size} groups — ${result.snapshot.displayDate}`,
      )
```

In `handleDeleteSnapshot` — read the site off the meta entry that was already
looked up as `target`, so the log cannot disagree with what was deleted:

```ts
      void logActivity(
        'delete',
        `rankings:${target?.site ?? activeSite.id}`,
        `Deleted snapshot ${target?.displayDate ?? id}`,
      )
```

In `handleEditCell` — resolve from the snapshot being patched, which is already
in scope as `snapshot`:

```ts
        void logActivity(
          'edit',
          `rankings:${snapshot?.site ?? activeSite.id}`,
          `Volume '${before?.searchVolume ?? ''}' → '${patch.searchVolume ?? ''}' · ${matcher.keyword ?? 'all keywords'}`,
        )
```

Add `activeSite.id` to the dependency arrays of `handleDeleteSnapshot` and
`handleEditCell`.

- [ ] **Step 9: Type-check and run the full suite**

Run: `npx tsc -b && npm test`
Expected: `tsc` clean apart from errors in `Sidebar.tsx` and `UploadModal.tsx`
(Tasks 8 and 9). All 100+ tests pass.

If `tsc` reports errors in `src/pages/Home.tsx` or `src/pages/Rankings.tsx`, they
are reading `ctx.snapshots` — which still exists with the same type — so the
error is something you introduced above. Re-read Step 7.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx
git commit -m "feat(routing): scope routes and app state by site"
```

---

## Task 8: The sidebar site switcher

**Files:**
- Modify: `src/components/Sidebar.tsx:16-23`, plus the nav render block around `:174-210`

**Interfaces:**
- Consumes: `SITES`, `type Site` from `../lib/sites`; `activeSite` passed as a new prop.
- Produces: `SidebarProps.activeSite: Site` — `App.tsx` must pass it.

- [ ] **Step 1: Make the nav paths site-relative**

In `src/components/Sidebar.tsx`, replace the `PAGES` constant. Paths become
suffixes joined onto the active site's slug; the two global pages are marked so
they are not prefixed:

```ts
const PAGES = [
  { path: '', label: 'Overview', icon: LayoutDashboard, global: false },
  { path: 'rankings', label: 'Rankings', icon: TrendingUp, global: false },
  { path: 'log', label: 'Activity', icon: History, global: true },
  { path: 'how-it-works', label: 'How it works', icon: HelpCircle, global: true },
] as const

const ADMIN_PAGE = { path: 'admin/users', label: 'Users', icon: Users, global: true } as const

/** Global pages live at the root; site pages hang off the active site's slug. */
function hrefFor(page: { path: string; global: boolean }, site: Site): string {
  if (page.global) return `/${page.path}`
  return page.path ? `/${site.slug}/${page.path}` : `/${site.slug}`
}
```

- [ ] **Step 2: Add the prop**

Add the import:

```ts
import { SITES, type Site } from '../lib/sites'
```

Add `activeSite: Site` to the `SidebarProps` interface and destructure it in the
component signature alongside the existing props.

- [ ] **Step 3: Render the switcher**

Insert this immediately above the `{pages.map(...)}` nav block. Two sites is too
few to justify a dropdown — a segmented pair is one click instead of two:

```tsx
        {/* Site switcher. A NavLink per property rather than a select: with two
            options a dropdown costs an extra click and hides the alternative. */}
        <div className={expanded ? 'mb-3 px-3' : 'mb-3 px-2'}>
          {expanded && (
            <div
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: 'var(--muted)' }}
            >
              Property
            </div>
          )}
          <div className="flex flex-col gap-1">
            {SITES.map((site) => {
              const active = site.id === activeSite.id
              return (
                <Link
                  key={site.id}
                  to={`/${site.slug}`}
                  title={expanded ? undefined : site.name}
                  className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[12px] transition-colors"
                  style={{
                    background: active ? 'var(--active-tint)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--muted)',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: site.color }}
                    aria-hidden
                  />
                  {expanded && <span className="truncate">{site.name}</span>}
                </Link>
              )
            })}
          </div>
        </div>
```

- [ ] **Step 4: Point the nav links at `hrefFor`**

Replace the whole `{pages.map(...)}` callback. The active test must compare
resolved hrefs, not bare paths — with a site prefix, `startsWith('')` matches
everything and every row would render active:

```tsx
        {pages.map((page) => {
          const { label, icon: Icon } = page
          const href = hrefFor(page, activeSite)
          // Overview is an exact match; everything else is a prefix, so
          // /kuwait/rankings/rabona still lights up Rankings.
          const active =
            href === `/${activeSite.slug}`
              ? location.pathname === href
              : location.pathname.startsWith(href)
          return (
            <Link
              key={href}
              to={href}
              title={expanded ? undefined : label}
              className="flex items-center gap-2.5 rounded-lg py-2 text-[12px] font-medium transition-colors"
              style={
                active
                  ? {
                      background: 'var(--active-tint)',
                      borderLeft: '2px solid var(--brand-blue)',
                      // 12 − 2 so the label stays aligned with inactive rows.
                      paddingLeft: 10,
                      paddingRight: 12,
                      color: 'var(--navy-text)',
                    }
                  : { paddingLeft: 12, paddingRight: 12, color: 'var(--text-2)' }
              }
            >
              <Icon
                size={18}
                className="shrink-0"
                style={{ color: active ? 'var(--brand-blue)' : 'var(--muted)' }}
              />
              <span
                className={`truncate transition-opacity duration-150 ${
                  expanded ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {label}
              </span>
            </Link>
          )
        })}
```

In the contextual group list further down, change the group link's target:

```tsx
                  to={`/${activeSite.slug}/rankings/${slug}`}
```

The `inRankings` flag just above that block tests the pathname for `/rankings`.
Confirm it still matches with the site prefix in place — `location.pathname.includes('/rankings')`
is correct; `startsWith('/rankings')` is not.

- [ ] **Step 5: Pass the prop from `App.tsx`**

In `src/App.tsx`, add `activeSite={activeSite}` to the `<Sidebar ... />` element.

- [ ] **Step 6: Verify**

Run: `npx tsc -b && npm test`
Expected: clean apart from `UploadModal.tsx` (Task 9); all tests pass.

Run `npm run dev`, open the app, and confirm: the switcher shows both properties,
clicking Kuwait changes the URL to `/kuwait`, the nav links stay within the
selected property, and Activity / How it works remain at their global paths.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(sidebar): add the property switcher and site-relative nav"
```

---

## Task 9: Upload targets a site

**Files:**
- Modify: `src/components/UploadModal.tsx:6-18`, and its parse call around `:60`
- Modify: `src/App.tsx` — the `<UploadModal>` element and `handleUploadConfirm`

**Interfaces:**
- Consumes: `SITES`, `type Site` from `../lib/sites`; `parseSheet(buffer, siteId)` from Task 3.
- Produces: `UploadModalProps.defaultSiteId: string`; `onConfirm(result: ParseResult)` unchanged — the site now rides inside `result.snapshot.site`.

- [ ] **Step 1: Add the prop and local state**

In `src/components/UploadModal.tsx`, add to the imports:

```ts
import { SITES } from '../lib/sites'
```

Add `defaultSiteId: string` to `UploadModalProps`, destructure it, and add state:

```ts
  // Defaults to the property you are currently looking at, which is almost
  // always the one you are uploading for.
  const [siteId, setSiteId] = useState(defaultSiteId)
```

- [ ] **Step 2: Pass the site into the parse**

`parseSheet` is dynamically imported inside `handleFile` (line 40-44). Pass the
selected site as its second argument:

```ts
      const result = parseSheet(buffer, siteId)
```

- [ ] **Step 3: Render the selector**

Insert above the file input, so the target is chosen before a file is picked:

```tsx
        <div className="mb-4">
          <div
            className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: 'var(--muted)' }}
          >
            Import into
          </div>
          <div className="flex gap-2">
            {SITES.map((site) => (
              <button
                key={site.id}
                type="button"
                onClick={() => setSiteId(site.id)}
                className="flex flex-1 items-center gap-2 rounded-[8px] border px-3 py-2 text-[12px] transition-colors"
                style={{
                  borderColor: site.id === siteId ? site.color : 'var(--border)',
                  background: site.id === siteId ? 'var(--active-tint)' : 'transparent',
                  color: site.id === siteId ? 'var(--ink)' : 'var(--muted)',
                  fontWeight: site.id === siteId ? 600 : 400,
                }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: site.color }}
                  aria-hidden
                />
                <span className="truncate">{site.name}</span>
              </button>
            ))}
          </div>
        </div>
```

- [ ] **Step 4: Clear the parsed file when the target changes**

A file parsed under one property still carries that property's site in
`parsed.snapshot.site`. Switching the target afterwards would import it to the
wrong place, and nothing on screen would reveal it.

Clear the review state on switch — the same reset the existing "Choose another"
button performs. Replace the `onClick` in the selector from Step 3:

```tsx
                onClick={() => {
                  if (site.id === siteId) return
                  setSiteId(site.id)
                  // A file parsed for the other property is stale: its snapshot
                  // already carries the old site id.
                  setParsed(null)
                  setError(null)
                  setDateOverride('')
                }}
```

Guarding on `site.id === siteId` means re-clicking the already-selected property
does not discard a file the user just chose.

- [ ] **Step 5: Pass the prop and fix the duplicate check**

In `src/App.tsx`, pass the default:

```tsx
        <UploadModal
          defaultSiteId={activeSite.id}
          onClose={() => setShowUpload(false)}
          onConfirm={handleUploadConfirm}
        />
```

`handleUploadConfirm` (line 273) already compares `m.id === result.snapshot.id`,
and ids are now site-scoped, so the duplicate check is per-site with no change.
Confirm this by reading it — do not modify it.

- [ ] **Step 6: Verify**

Run: `npx tsc -b && npm test && npm run build`
Expected: all clean, all tests pass.

Run `npm run dev` and confirm: the upload dialog defaults to the property you were
viewing, switching the target clears the chosen file, and importing while Kuwait
is selected produces a snapshot that appears only under Kuwait.

- [ ] **Step 7: Commit**

```bash
git add src/components/UploadModal.tsx src/App.tsx
git commit -m "feat(upload): choose the target property at import time"
```

---

## Task 10: Copy, docs and final verification

**Files:**
- Modify: `src/pages/HowItWorks.tsx`
- Modify: `README.md`

- [ ] **Step 1: De-hardcode the property in `HowItWorks.tsx`**

The page is a `SECTIONS` array of `{ title, body }` rendered by a single `.map`,
plus one intro paragraph. There is no `Section` component.

Replace the hard-coded intro (line 87):

```tsx
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
        This dashboard tracks Google keyword positions for{' '}
        <strong>hazreviews.com</strong> and <strong>onlinecasinokuwait.com</strong>{' '}
        over time. Each import is stored as an immutable dated snapshot, so history
        never changes underneath you. Below are the rules that are not obvious from
        the screen — every one of them looks like a bug until you know it.
      </p>
```

Add a new entry to the `SECTIONS` array. Put it first, since it explains the
navigation everything else assumes:

```tsx
  {
    title: 'Two properties, one dashboard',
    body: (
      <>
        Use the property switcher at the top of the sidebar to move between
        HAZREVIEWS and OnlineCasinoKuwait. The address bar changes with it, so a
        link you copy points at the property you were looking at. Imports,
        snapshots, date selections and search volumes are kept entirely separate
        per property — nothing carries across. Keyword groups are the one shared
        thing, so a casino brand appearing on both sites keeps the same colour in
        both places.
      </>
    ),
  },
```

Then re-read the "Re-importing the same date replaces it" section: it says
snapshots are identified by their date, which is now only true within a
property. Amend it to "identified by their date and property".

- [ ] **Step 2: Update `README.md`**

Update the project description to name both properties, and add the migration to
whatever setup or deployment steps the README documents:

```markdown
Existing databases must run `supabase/add-site-column.sql` once, in the Supabase
SQL editor, before deploying this version. Fresh databases get the column from
`supabase/setup.sql` and can skip it. The script is idempotent.
```

- [ ] **Step 3: Full verification**

Run each of these and confirm the stated result:

```bash
npm test          # all tests pass, including the 98 pre-existing ones
npx tsc -b        # no output
npm run build     # builds clean
```

- [ ] **Step 4: Manual smoke test**

Run `npm run dev` and walk the whole surface:

1. `/` redirects to `/hazreviews`.
2. Existing HAZREVIEWS data still renders — groups, matrix, stats, date tabs.
3. The switcher moves to `/kuwait`, which shows the empty state (not an error).
4. `/nonsense` redirects to the default site.
5. Activity, How it works and Users are reachable and unprefixed.
6. Sign in and import a file with Kuwait selected; it appears under Kuwait only.
7. Switch to HAZREVIEWS and confirm its date selection was not disturbed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/HowItWorks.tsx README.md
git commit -m "docs: describe the two-property dashboard and the migration step"
```

---

## Deferred: Kuwait's keyword groups

Not a task in this plan, because it needs a real OnlineCasinoKuwait export that
does not exist yet.

Once a sample file is available: import it, read the "keywords not matched to a
group" warning the upload already surfaces, and append one `GROUPS` entry per
Kuwait casino brand in `src/lib/groups.ts`. Purely additive — no structural
change, and `groups.test.ts` already guards the alias rule that makes this
risky. Until then those keywords land in `OTHER_GROUP`, which is visible and
correct rather than silently misclassified.

If the Kuwait export turns out not to match the HAZREVIEWS flat format, the
change is contained to `parser.ts` and affects nothing else in this plan.
