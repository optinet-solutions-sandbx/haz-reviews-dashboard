# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run dev       # Vite dev server on localhost:3002 (strictPort)
npm run build     # tsc -b && vite build — the primary regression net
npm test          # vitest run — 98 tests, node environment
npm run test:watch
```

There is no `/api` directory and no serverless function, so `npm run dev` serves
the whole app. Everything works under plain `npm run dev`.

## What this is

React 19 + TypeScript + Tailwind v4 SPA (Vite) tracking Google keyword rankings for
`hazreviews.com`, an affiliate casino-review site. Supabase provides Postgres, Auth
and RLS. The visual system and app shell are shared with the sibling
`Ranking-Reports` and `BIF-Dashboard` projects.

- Spec: `docs/superpowers/specs/2026-08-04-haz-reviews-dashboard-design.md`
- Plan: `docs/superpowers/plans/2026-08-04-haz-reviews-dashboard.md`

## Architecture

1. **No backend for the data path.** The browser talks to PostgREST directly.
   Security lives entirely in RLS policies.
2. **One state container.** `Layout` in `src/App.tsx` owns everything. No Redux,
   no Zustand, no Context-for-data. Pages read state via
   `useOutletContext<HzOutletContext>()` and never import from one another.
3. **Raw state, derived views.** State holds exactly what the DB holds. Every
   transformation (carry-forward, stats, grouping) is a pure function recomputed in
   `useMemo`. This is what makes live edits propagate correctly.
4. **The group registry is one file.** `src/lib/groups.ts`.

### The single biggest difference from the siblings

Those projects model **brand → many domains** and use domain as a matrix axis.
HazReviews is **one site**, so that model does not transfer — the domain column
would be constant. Keywords are grouped instead:

- `groupForKeyword(keyword)` resolves a keyword to exactly one group.
- **Membership is derived at render time and never stored on a record.** Improving
  the registry re-groups all history retroactively; a stored column would freeze
  today's mistakes and need a backfill migration.
- Matching is **word-boundary only**. Substring matching classifies the real keyword
  `live blackjack` as the real brand `Jack.com`. A **brand match beats any category
  match regardless of phrase length**, or the 2-token `free spins` steals
  `lucky7even free spins` from `Lucky7Even`. Both are covered in `groups.test.ts`.

## Data flow

1. **Import** — `UploadModal` dynamically imports `src/lib/readWorkbook.ts` (the only
   module that touches `xlsx`, ~333 kB, kept out of the initial bundle) and calls
   `parseSheet` → `parseRows`, the pure core.
2. **Persist** — `upsertSnapshot` in `src/lib/storage.ts`. Wipe-and-replace keyed on
   a deterministic `snap-<raw_date>` id, so a same-date re-import replaces rather
   than duplicates. **Not atomic** — several round trips, no transaction. A partial
   failure leaves that date incomplete and the error path tells the user to re-run,
   which is safe precisely because the operation is idempotent.
3. **Read** — `loadRecentSnapshots` fetches all metadata (cheap) but records only for
   the newest 8 snapshots. `loadOlderSnapshots` hydrates more on demand.
4. **Display** — `Home` summarises; `Rankings` renders the group grid and matrix.

## Invariants

Violating any of these produces silent wrongness rather than an error.

1. **Never remove the parallel pagination** in `loadSnapshotRecords`. PostgREST
   truncates at 1,000 rows *without erroring*; a single select makes every counter
   read low with no visible failure.
2. **Never apply carry-forward to stored state.** Inheritance freezes and edits stop
   propagating downstream.
3. **Never seed carry-forward maps from derived values.** A cleared upstream value
   would flow forward forever with no way to delete it.
4. **Never rely on `ON DELETE CASCADE` in the upsert path.** Delete child rows
   explicitly or a re-import doubles the data on a database where the cascade was
   never actually configured.
5. **Never add `[session]` to `requireAuth`'s dependency array.** It must keep a
   stable identity and read from refs — async callers captured before sign-in would
   otherwise see stale state.
6. **Never put a bare `exists (select … from user_access …)` in a policy *on*
   `user_access`.** Postgres raises `42P17`. Use the `SECURITY DEFINER` helpers.
7. **Never let `--mx-*` backgrounds carry alpha.** Sticky cells overlay scrolled
   content and rows would show through. `--mx-hover` is the only exception.
8. **Never use `toISOString().slice(0,10)` on a local date**, and never let
   `new Date('YYYY-MM-DD')` produce a display date. Both shift the day by one, in
   opposite timezone halves.
9. **Never compare positions against raw source strings.** Compare against `'NR'`
   after `parsePosition`.
10. **Never treat `WriteGate` or `requireAuth` as security.** RLS is the boundary.
11. **Never order snapshots by `created_at` alone.** Order by `raw_date` first.
12. **Never let a failed audit-log write block its mutation.** `logActivity` stays
    non-throwing and un-awaited (`void logActivity(...)`).
13. **Never make an admin-gated redirect decision while `accessLoading` is true.**
    A real admin gets bounced off their own page on load.
14. **Never assume the five stat cards sum to the total.** Top 3 overlaps the
    movement buckets by design.
15. **Never trust a stored `display_date` on read.** Re-derive from `raw_date`.
16. **Never store a derived group on a record.** Retroactive re-grouping depends on
    it.
17. **Never drop an unmatched keyword or an unlisted market.** Surface it instead —
    Other group, appended column, import summary.
18. **Never render a failed load as an empty dataset.** `snapshotsError` exists so
    "could not reach the database" and "no data yet" stay distinguishable.
19. **Never omit `@source not "../docs"`** from `src/index.css`, or Tailwind v4
    generates real CSS from class-looking strings inside committed markdown.

## Conventions

| Convention | Detail |
|---|---|
| Comments | Explain **why**, and specifically why the obvious alternative is wrong |
| Exports | Named only; no default exports in `src/` |
| Types | All shared types in `src/types/index.ts`; local types stay local |
| `import type` | Always, for type-only imports (`verbatimModuleSyntax`) |
| Naming | `handleX` for container handlers, `onX` for props, `useX` for hooks, `loadX`/`upsertX`/`deleteX` for storage |
| DB ↔ TS | `snake_case` in SQL, `camelCase` in TS, mapped explicitly in the storage layer |
| localStorage | `hz_` prefix, every access wrapped in `try/catch` |
| Styling | Tailwind utilities with `var(--token)`; no hex outside `src/index.css`; inline `style` only for computed values |
| Sections | `// ─── Name ───────` separators inside long files |
| Errors | `err instanceof Error ? err.message : String(err)` → toast |

## Testing

Vitest, node environment, `src/**/*.test.ts`. Coverage is concentrated on pure logic
where silent data corruption would originate: `groups` (keyword matching),
`parser` (including real xlsx and csv round-trips), `normalize`, `carryForward`,
`dates`, `storage` (pagination maths), `useAuth` (write-gate derivation), `theme`.

`npm run build` is the primary regression net — `tsc -b` covers both projects.

## Known state

The app has **not** been exercised against a live Supabase project — none was
provisioned during the build. Everything is type-checked, unit-tested, and verified
rendering in a browser (shell, dark mode, `requireAuth` gate, load-error path), but
the read/write round trip and RLS policies are unverified end to end. Do that first.

`MARKET_ORDER` is `['AE']`, an explicit assumption — see §12 of the spec for the
full list of decisions made without confirmation from the requestor.
