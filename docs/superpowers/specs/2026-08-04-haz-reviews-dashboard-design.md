# Haz Reviews Dashboard — Design

**Date:** 2026-08-04
**Status:** Approved, implementation in progress
**Subject site:** [hazreviews.com](https://hazreviews.com) — an affiliate site publishing independent online-casino reviews (WordPress/Divi, en-AE market, crypto-payment heavy).
**Template:** `SYSTEM_DESIGN.md` (extracted from the `Ranking-Reports` codebase). Siblings: `Ranking-Reports`, `BIF-Dashboard`.

---

## 1. Purpose

An internal single-page dashboard tracking Google keyword rankings for `hazreviews.com` over time.

> A spreadsheet arrives on a cadence → parsed in the browser → persisted as an immutable dated **snapshot** → rendered as a matrix with movement indicators, cross-snapshot comparison, filtering, inline editing, an audit log, and an approval-gated auth layer.

The recurring job it replaces: eyeballing a ranking export in a spreadsheet and trying to remember what last week looked like.

## 2. Why import-first, and not the ranking API

`BIF-Dashboard` ingests from a shared ranking panel (`ranks.php` on the BPN panel, one `SITES_API_KEY`, projects selected by `project_id` — 18 = BIF, 0 = Rooster). The obvious plan was to point a new dashboard at a new `project_id`.

**That is not currently possible.** A read-only `action=domains` call against that panel on 2026-08-04 returned 135 domains — 103 under project 18, 51 under project 0 — and **no `hazreviews.com`**. Someone would have to add the site and its keywords to the panel first, so an API-first build would be dead on arrival.

Two other sources are plausible from the site's own markup: it carries an **Ahrefs** site-verification tag and **GA4** (`G-456NDX8TRE`).

**Decision:** ingest is a spreadsheet drop. It works today, needs no external dependency, and accepts an export from Ahrefs, Search Console, or the panel equally well.

**Deliberately preserved seam:** if `hazreviews.com` later lands in the panel, a Refresh button is one new module that emits the same `Snapshot` object. Nothing downstream changes. This is a property of the architecture, not extra code written up front — so no speculative API layer is built now.

## 3. The one real structural departure from the template

The template's entity model is **brand → many domains**, and the matrix uses domain as a column axis. HazReviews is **one site**. The domain column would be constant and worthless as an axis, and `DOMAIN_TO_BRAND` has nothing to map.

Replacement: **keyword groups.**

- `src/lib/groups.ts` is the single registry — the reviewed casino brands (Cleobetra, Rabona, Jack.com, FortunePlay, Lucky7Even, Kingmaker, …) plus content categories (crypto casinos, bonuses, slots, live games), each with `name`, `abbr`, `color`, `aliases`, `kind: 'brand' | 'category'`.
- Group membership is **derived, never stored**: `groupForKeyword(keyword)` matches a keyword against brand names and aliases, then category patterns, then falls back to the `Other` group.
- Nothing is ever dropped for being unmatched. Unmatched keywords land in `Other` and are reported in the import summary so the registry can be improved.

**Why derived and not a stored column:** improving the registry re-groups the entire history retroactively. A stored `group_key` would freeze yesterday's classification mistakes into the record forever, and every registry fix would need a backfill migration.

### 3.1 The dangerous part

Keyword→group matching is the one piece of logic here that can be silently, confidently wrong. The brand **`Jack.com`** against the keyword **`live blackjack`** is a real collision in this dataset, and naive `includes()` matching gets it wrong.

Rules:
1. Normalize both sides (lowercase, strip punctuation to spaces, collapse whitespace).
2. Match on **word boundaries** only — `jack` must not match inside `blackjack`.
3. **Longest match wins** — `lucky7even casino` beats `lucky7even`; a brand match beats a category match.
4. Explicit `aliases` carry the irregular cases (`jack com`, `bc game`, `wild io`).
5. Ties broken by registry order, deterministically.

`src/lib/groups.test.ts` covers this class of bug explicitly, including `live blackjack` ≠ `Jack.com`. Per the template, pure logic is where silent data corruption originates, so this is where test effort goes.

## 4. Data model

Two tables. **No `category` column** — the template's `bp-sites`/`lp-sites` split is a two-namespace feature and this project has one namespace. Adding it "just in case" would mean every query carries a predicate that is always true.

```sql
create table if not exists public.snapshots (
  id            text primary key,   -- client-generated: 'snap-<raw_date>'
  raw_date      text not null,      -- 'YYYY-MM-DD'
  display_date  text not null,      -- re-derived on read, never trusted
  created_at    timestamptz not null default now()
);

create table if not exists public.ranking_records (
  id            bigserial primary key,
  snapshot_id   text not null references public.snapshots(id) on delete cascade,
  keyword       text not null,
  market        text not null,
  position      text not null,           -- TEXT: holds 'NR' / 'Not in top 100'
  previous      text not null default '',
  change        text not null default '', -- verbatim source token
  url_found     text not null default '',
  search_volume text not null default '',
  date          text not null default ''
);
```

Indexes: `snapshots (raw_date desc)`, `ranking_records (snapshot_id)`, and a composite `(snapshot_id, keyword, market)` matching the `updateRecordFields` predicate exactly.

Carried over from the template because each prevents a specific class of bug:

| Choice | Reason |
|---|---|
| `position` is `text` | Source vocabulary includes `NR`, `Not in top 100`, `-`. Normalization happens at the view layer via `parsePosition()`, so no information is destroyed at write time. |
| `change` stores the source token verbatim | Badges render what the export showed; deltas are computed separately. Kills the "which side of the parens is the previous position" bug class. |
| Deterministic client-generated ids | Makes wipe-and-replace upsert natural and idempotent. |
| `display_date` re-derived on read | Rows written under an older format still render correctly. |

`url_found` earns its place here in a way it would not for a brand portfolio: on a review site, *which page ranks* for a term is a primary question — a category page outranking the intended brand review is exactly the problem this dashboard should surface.

### 4.1 Markets

`MARKET_ORDER` in the registry drives matrix column order. Unlisted markets are **appended and flagged, never dropped** — losing data silently is worse than showing an unexpected column.

**Stated assumption:** the real market list is unknown (UAE-primary is inferred from the `en-AE` tag and the linked `hazemirates.com`, not confirmed). `MARKET_ORDER` therefore ships as `['AE']` and everything else appends alphabetically until the first real export arrives. Correcting it is a one-line edit.

### 4.2 Editable field and carry-forward

One editable field: `searchVolume`. Many ranking exports omit volume, and it is stable enough to be worth entering by hand once.

`applyCarryForward()` fills empty `searchVolume` values forward, keyed on `keyword|market`, oldest → newest. It **seeds from raw values, never derived ones** — otherwise a cleared upstream value flows forward forever. Carry-forward is applied in a `useMemo` over raw state and never written to the database; applying it at load time would freeze inheritance and stop edits propagating downstream.

One editable field is enough to make `EditableCell`, carry-forward, and the audit log all meaningful without a wide write surface.

## 5. Ingest

`parseSheet(buffer)` — flat single-sheet only. The template's matrix-workbook parser exists for a legacy Google Sheets layout that does not apply here.

- Accepts `.xlsx`, `.xls`, `.csv`.
- Header row auto-detected by scanning the first 5 rows for `keyword`.
- Columns resolved exact-or-prefix: `keyword`, `country|market|location`, `position|rank`, `previous`, `change`, `url`, `volume|search volume`, `date|last check`.
- Rows with an empty keyword are skipped and counted.
- In-upload dedupe by `keyword|market`, last occurrence wins.
- Snapshot date = the modal (most frequent) value of the date column, **overridable in the upload modal** — many exports carry no date column at all, and a mislabeled snapshot corrupts every movement calculation downstream.
- Same-date re-upload → `DuplicateWarning` → Replace or Cancel.

Import summary reports: records imported, keywords, markets, unmatched-keyword count, and the resolved snapshot date.

Date handling follows the template's rules exactly: `toIsoLocal()` instead of `toISOString().slice(0,10)`, and `formatDisplayDate()` parses `YYYY-MM-DD` into a **local** `Date`. Both directions shift the day by one otherwise, in opposite timezone halves.

## 6. Pages

| Path | Contents |
|---|---|
| `/` | KPI totals (keywords tracked, avg position, page-1 count and %), tier distribution (P1 / top3 / top10 / page2 / NR), group leaderboard, top movers |
| `/rankings` | Group grid — one card per brand/category with keyword count and avg position |
| `/rankings/:groupSlug` | Detail matrix: stat cards as filters, market columns, keyword search, one section per date, load-older-history |
| `/log` | Activity log — who changed what, when |
| `/admin/users` | Access console (self-redirects non-admins, but only after `accessLoading` resolves) |
| `/how-it-works` | In-app documentation of the non-obvious rules |

Stat cards are **toggle filters**, not static readouts. The five cards deliberately do not sum to the total: Top 3 overlaps the movement buckets by design, and `/how-it-works` explains this to users.

## 7. Auth

Supabase Auth with the template's three-state approval model (`pending` / `approved` / `revoked` — `revoked` is a distinct third state so a deliberately cut-off user is never mistaken for a new signup), admin console, and the `user_is_admin()` `SECURITY DEFINER` function to avoid the `42P17` RLS recursion trap on self-referential policies.

**Departure from the template:** reads require auth as well as writes (`VITE_REQUIRE_AUTH=true`). The template ships anon-open reads because it grew that way; nothing here is public and a single rule is easier to keep correct.

`WriteGate` and `requireAuth` remain presentational/procedural only. RLS is the security boundary.

## 8. Testing

Vitest, node environment. Coverage concentrated on pure logic with real consequences:

| File | Covers |
|---|---|
| `groups.test.ts` | Keyword→group matching, word boundaries, `live blackjack` ≠ `Jack.com`, longest-match-wins, alias resolution, `Other` fallback |
| `parser.test.ts` | Header detection, column resolution, dedupe, modal date, skipped rows |
| `normalize.test.ts` | `parsePosition`, `parseChange`, `effectiveDelta`, `computeStats` bucket exclusivity |
| `carryForward.test.ts` | Fill-only-if-empty, raw seeding, cleared value does not flow forward |
| `dates.test.ts` | `toIsoLocal` / `formatDisplayDate` timezone correctness |

`npm run build` (`tsc -b` across three projects) is the primary regression net.

## 9. Scope

**In v1:** everything above.

**Out of v1** (all listed as first-to-drop in the template, none blocking the core loop): AI assistant subsystem, SSO portal callback, voice input, secondary metric domain (the FTDs analogue), choropleth map, matrix-workbook parsing, Apps Script tier.

**Deferred but cheap later:** panel Refresh ingest (§2), AI assistant.

## 10. Infrastructure

| Layer | Choice |
|---|---|
| SPA | Vite 6 + React 19 + TS strict, three-project composite `tsconfig` |
| Styling | Tailwind v4, CSS-variable tokens only, no `tailwind.config.js`, `@source not "../docs"` |
| Database | **New** Supabase project (assumption — siblings each own one) |
| Hosting | Vercel, `vercel.json` SPA rewrite |
| Dev port | **3002**, `strictPort` — 3000 is Ranking-Reports, 3001 is TryBet |
| localStorage prefix | `hz_` |

Env contract: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_REQUIRE_AUTH`. `src/lib/supabase.ts` throws at module load if either required var is missing.

## 11. Invariants

Carried from the template because violating any produces silent wrongness rather than an error:

1. Never remove parallel pagination — PostgREST truncates at 1,000 rows without error.
2. Never apply carry-forward to stored state.
3. Never seed carry-forward maps from derived values.
4. Never rely on `ON DELETE CASCADE` in the upsert path — delete children explicitly.
5. Never add `[session]` to `requireAuth`'s dependency array — use refs.
6. Never put a bare `exists (select … from user_access …)` in a policy *on* `user_access`.
7. Never let `--mx-*` backgrounds carry alpha — sticky cells overlay scrolled content.
8. Never use `toISOString().slice(0,10)` on a local date.
9. Never compare positions against raw source strings — compare against `'NR'` after `parsePosition`.
10. Never treat `WriteGate` or `requireAuth` as security.
11. Never order snapshots by `created_at` alone — order by `raw_date` first.
12. Never let a failed audit-log write block its mutation.
13. Never make an admin-gated redirect decision while `accessLoading` is true.
14. Never assume the five stat cards sum to the total.
15. Never trust a stored `display_date` on read.

Project-specific additions:

16. Never store a derived group on a record — §3 depends on retroactive re-grouping.
17. Never drop an unmatched keyword or an unlisted market — surface it instead.

## 12. Open assumptions

Recorded because they were decided without confirmation from the requestor, and each is a one-line correction:

1. **Markets** — `MARKET_ORDER = ['AE']`, others appended (§4.1).
2. **Cadence** — weekly assumed; nothing in the design depends on it.
3. **Group registry** — brands seeded from the toplist on hazreviews.com as of 2026-08-04; the category set is inferred from site navigation.
4. **Supabase** — a new project, not a reused one.
5. **Auth-gated reads** — stricter than the siblings (§7).
