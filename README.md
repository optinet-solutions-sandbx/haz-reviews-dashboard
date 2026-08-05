# Haz Reviews Dashboard

Internal dashboard tracking Google keyword rankings for two affiliate properties
publishing independent online-casino reviews:
[hazreviews.com](https://hazreviews.com) and
[onlinecasinokuwait.com](https://onlinecasinokuwait.com). One deployed link covers
both; the sidebar switches between them and the URL carries the selection.

A ranking export is dropped in, parsed in the browser, and stored as an immutable
dated **snapshot**. The dashboard renders it as a spreadsheet-fidelity matrix with
movement indicators, filters, inline editing, an audit log, and approval-gated
access.

- **Spec:** [docs/superpowers/specs/2026-08-04-haz-reviews-dashboard-design.md](docs/superpowers/specs/2026-08-04-haz-reviews-dashboard-design.md)
- **Plan:** [docs/superpowers/plans/2026-08-04-haz-reviews-dashboard.md](docs/superpowers/plans/2026-08-04-haz-reviews-dashboard.md)
- **Second property (spec):** [docs/superpowers/specs/2026-08-05-second-site-onlinecasinokuwait-design.md](docs/superpowers/specs/2026-08-05-second-site-onlinecasinokuwait-design.md)
- **Second property (plan):** [docs/superpowers/plans/2026-08-05-second-site-onlinecasinokuwait.md](docs/superpowers/plans/2026-08-05-second-site-onlinecasinokuwait.md)

Visual system and app shell are shared with the sibling `Ranking-Reports` and
`BIF-Dashboard` projects.

## Commands

```bash
npm install       # .npmrc sets legacy-peer-deps
npm run dev       # Vite dev server on http://localhost:3002 (strictPort)
npm run build     # tsc -b (two projects) && vite build
npm run preview   # preview the production build
npm test          # vitest run  — 115 tests
npm run test:watch
```

Port **3002** is deliberate: 3000 belongs to `Ranking-Reports` and 3001 to
`TryBet-Dashboard`. `strictPort` makes a collision fail loudly rather than moving
the server somewhere unexpected.

## Setup

### 1. Environment

```bash
cp .env.example .env.local
```

| Var | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase anon key |
| `VITE_REQUIRE_AUTH` | no | `'true'` gates the whole app behind sign-in + approval. This project runs with it on. |

`src/lib/supabase.ts` throws at module load if either required var is missing —
fail fast beats a confusing 401 from every query.

### 2. Database

In the Supabase SQL editor, run in this order:

1. `supabase/setup.sql` — tables, indexes, trigger, helper functions, permissive RLS
2. `supabase/auth-lockdown.sql` — reads and writes both require an approved account

Both files are idempotent and safe to re-run.

**Upgrading an existing database to the two-property version:** run
`supabase/add-site-column.sql` once, before deploying. It adds `snapshots.site`,
backfills every existing row to `hazreviews`, and rewrites snapshot ids from
`snap-<date>` to `snap-hazreviews-<date>`. Databases created from the current
`setup.sql` already have the column and must skip it. The script is idempotent —
a second run is a no-op.

### 3. Seed the first admin

Sign up through the app once, then:

```sql
update public.user_access
set status = 'approved', is_admin = true
where email = 'you@example.com';
```

From then on, approvals happen in the UI at `/admin/users`.

## Importing data

Click **Import Data** and drop an `.xlsx`, `.xls` or `.csv` export. Only a
**Keyword** column is required; `country`/`market`, `position`/`rank`, `previous`,
`change`, `url`, `volume` and `date`/`last check` are all picked up automatically
when present, by exact-or-prefix header match.

The modal shows a review panel before anything is written: record count, markets,
the detected snapshot date (**editable** — many exports carry no date, and a
mislabelled snapshot breaks every movement calculation), and how many keywords did
not match a group.

Re-importing the same date replaces that snapshot rather than duplicating it, after
a confirmation.

## Adding a keyword group

Each property is one domain, so there is no brand→domain registry. Keywords are
grouped instead, and **group membership is derived, never stored** — so improving
the registry re-groups the whole history retroactively, with no backfill.

The registry is **shared across both properties**. Because membership is derived,
a shared list self-filters: a group with no matching keywords on the active
property simply does not render. That keeps a brand appearing on both sites
consistent in colour and aliases, with one place to fix a matching bug.

Add one entry to `GROUPS` in [src/lib/groups.ts](src/lib/groups.ts):

```ts
{ name: 'NewBrand', abbr: 'NB', color: '#1C7ED6', kind: 'brand', aliases: ['new brand'] },
```

Then `npm test` — `groups.test.ts` guards the matching rules. **Never add an alias
that is a token appearing inside an unrelated word.** A bare `jack` alias would
classify `live blackjack` as the brand `Jack.com`; there is a test for exactly that.

## Markets

`MARKET_ORDER` in `src/lib/groups.ts` controls matrix column order. Markets not in
that list are **appended and flagged, never dropped**.

It currently ships as `['AE']` — an explicit assumption, since the real market list
was never confirmed (UAE-primary is inferred from the site's `en-AE` tag and its
link to `hazemirates.com`). Correct it once a real export lands.

## Deploy

```bash
npm run build
# Vercel: connect the repo, set the three VITE_ vars, deploy.
# vercel.json handles the SPA fallback.
```

## Not built (deliberately)

Out of scope for v1, each listed as first-to-drop in the source template: the AI
assistant subsystem, the SSO portal callback, voice input, a secondary metric
domain, the choropleth map, and legacy matrix-workbook parsing.

If `hazreviews.com` is later added to the shared BPN ranking panel, a Refresh
button becomes one new module emitting the same `Snapshot` — no redesign. See §2
of the spec for why the API could not be the source today.
