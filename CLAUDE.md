# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run dev       # Vite dev server on localhost:3002 (strictPort)
npm run build     # tsc -b && vite build — the primary regression net
npm test          # vitest run — 253 tests, node environment
npm run test:watch
```

`api/ask-ai.ts` is the only serverless function and it exists for DEPLOYED builds
only: under `npm run dev` that same path is served by the Vite middleware in
`vite/askAiProxy.ts`. Everything works under plain `npm run dev` — nothing local
needs Vercel.

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
This one does not: a site **scopes the whole view** rather than becoming a column,
so within any one view the domain is constant and cannot carry the matrix. Keywords
are grouped instead:

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
19. **Never change one rail width without the other three.** `RAIL_EXPANDED` and
    `RAIL_COLLAPSED` in `Sidebar.tsx`, the spacer in `App.tsx`, and `TOGGLE_LEFT`
    are not derived from one another. The aside is `fixed`, so disagreement either
    floats the rail over the content or opens a dead gap beside it.
20. **Never let the Topbar hamburger's breakpoint drift from the aside's.** Both
    are `md`. If the aside becomes a rail at `md` while the hamburger hides at
    `sm`, 640–768px gets no navigation at all — no rail and no way to open one.
21. **Never fade a `whitespace-nowrap` label to hide it in the collapsed rail.**
    With no `overflow: hidden`, its flex minimum size is min-content, so an
    `opacity-0` label still occupies full width — enough to shove a centred row's
    icon clean off the 64px rail. Render it conditionally instead. Icon-first rows
    survive this only because the icon is `shrink-0`.
22. **Never let a control's accessible name come only from a label the collapsed
    rail drops.** `writeGate.title` is `undefined` whenever writes are allowed, so
    the Import button carries its own `aria-label`.
23. **Never read `allSnapshots` outside `Home` and `AskAi`.** It is the unfiltered
    set across every site. Every other page must use `snapshots`, which is narrowed
    to `activeSite` — reading the wrong one silently mixes one site's numbers into
    another site's page. One site is registered again, so the two sets currently
    hold the same rows and the mistake is INVISIBLE rather than fixed: it costs
    nothing to make today and surfaces as inflated totals — never as an error —
    on whatever day a second property is registered.
    Both exceptions narrow it themselves and must keep doing so: `Home` picks
    between the two on `scoped`, and `AskAi` has its own site `<select>`, so
    `buildAskAiContext` filters by `site.id` internally. Do not "correct" `AskAi`
    to `snapshots` — that would make every site in its dropdown except the active
    one answer "no data has been imported", which looks like missing data rather
    than a wiring mistake.
24. **Never remove a site from the registry once data exists under its id.**
    `siteById` falls back to the default site for an unknown id, so orphaned
    snapshots do not error — they silently merge into the default site's figures.
    Asserted in `sites.test.ts`. Removing an entry is safe only while nothing has
    been imported under it. **That carve-out has now been used:** the five Trybet
    properties were removed by request, which was safe precisely because nothing
    had ever been imported under their uuids. `HAZREVIEWS` is the only entry left.
    Re-adding a property is one entry; deleting one after an import is a migration.

    A corollary on names: two entries must not derive the same monogram, or the
    site directory shows two identical tiles and reads as a duplicated row. No
    entry needs an `abbr` today — one property cannot collide with itself — but
    `siteInitials` stops at three words, so one brand registered twice
    (`Haz Reviews (.ca)` and `Haz Reviews (.com)` both derive `HRC`) collides
    immediately. `siteMonogram` prefers an entry's `abbr` and a test holds the
    whole set distinct. Components call `siteMonogram`, never `siteInitials`.
25. **Never give a page two headings.** The Topbar no longer supplies a title;
    each page renders exactly one `<h1>` via `PageHeader` (or its own header row,
    as `GroupView` does). A page with none is anonymous, and one with two reads as
    two sections.
26. **Never omit `@source not "../docs"`** from `src/index.css`, or Tailwind v4
    generates real CSS from class-looking strings inside committed markdown.
27. **Never give the assistant's API key a `VITE_` prefix.** Vite inlines every
    `VITE_*` variable into the client bundle, so the key would be readable in
    devtools by anyone who loads the page. `OPENAI_API_KEY` is read in Node by
    `vite/askAiProxy.ts` and nothing under `src/` may ever import a provider SDK.
    Verified by grepping `dist/` for the key name and the provider host.
28. **Never build Ask AI's request history from the visible transcript.** The
    transcript holds the bare question; the data rides in the first user turn only.
    Replaying what is on screen drops the data from turn two onward and the model
    answers from nothing — fluently, with no error and no empty bubble. A turn
    therefore keeps `wire` beside `content`, and `buildWireMessages` is the only
    thing that assembles a payload. This shipped broken once: turn two reported 8
    keywords not ranking when the real count was 1.
29. **Never leave "which moved most" to the model.** `buildAskAiContext` ranks the
    movers itself. Asked to derive it from the rows, the model named the
    second-largest improvement — and the same numbers have to match the movers
    panel anyway, which is invariant 16's rule applied to the assistant.

30. **Never drop `[scrollbar-gutter:stable_both-edges]` from `<main>`.** The
    shared shell scrolls the window; here `main` owns the scroll, so its
    scrollbar is taken out of the box that centres every `max-w-*` page. Without
    the reserved gutter the centred column sits half a scrollbar left of the
    sibling dashboard's — the two look misaligned side by side even though every
    card in them measures identically — and it slides sideways again between a
    page that scrolls and one that does not. `both-edges`, not `stable`: one
    edge is stable but still off-centre.

31. **Never write an extensionless relative import in `api/` or `server/`.** Use
    `'../server/askAi.js'`, naming the EMITTED file, even though the source is
    `.ts`. Those two directories are the only code here that runs under raw Node
    ESM: Vercel transpiles each file separately instead of bundling, and
    `package.json` declares `"type": "module"`, so Node's resolver handles the
    specifier and demands an extension. Extensionless resolves perfectly in dev,
    because Vite resolves it and Node never sees it, then answers 500
    ERR_MODULE_NOT_FOUND on every deployed request. `tsc -b`, `vite build` and the
    whole suite pass either way. Asserted by `server/nodeEsm.test.ts`.
32. **Never export a Vercel function as `export default`.** Export named HTTP
    methods — `export function GET`, `export async function POST`. The export shape
    is what selects the calling convention, and the failure mode for mixing them is
    the worst available: a Web-style body behind a default export is handed
    `(IncomingMessage, ServerResponse)`, `request.method` exists on
    IncomingMessage so nothing throws, a `Response` is built and returned, and
    nothing ever writes to the real response — so every request hangs until
    `maxDuration` and answers 504, at 60 seconds of billed compute apiece. Again
    invisible to the type-check, the build and the suite. Asserted by
    `server/vercelHandlers.test.ts`.
33. **Never let an aborted probe resolve to an assistant status.**
    `probeAssistant` rethrows an `AbortError`, and the effect in `AskAi.tsx`
    re-checks `signal.aborted` before it calls `setStatus`. StrictMode mounts the
    page twice, so the cleanup ALWAYS cancels the first probe while it is still in
    flight; a bare `catch` that turns that cancellation into `{state:'offline'}`
    puts the dead probe in a race with the live one, and whichever settles last
    decides the UI. The failure is the worst kind of intermittent: a perfectly
    valid `OPENAI_API_KEY` renders "Assistant offline" with the composer disabled
    on roughly every other load, which reads as a missing key rather than as a
    race, and sends you off to re-check a key that was never the problem. Invisible to
    `tsc -b`, the build and the suite, all of which passed while it was broken;
    this file claimed the feature worked end to end in dev the whole time, and it
    did, on the loads where the live probe happened to land second. Caught in a
    browser: two GETs to `/api/ask-ai`, one `ERR_ABORTED` and one 200, with the
    aborted one deciding the page. An abort means "this answer is no longer
    wanted", never "the endpoint is down". Both layers are load-bearing — with the
    rethrow but no `catch` on the promise, every mount logs an unhandled
    rejection. Asserted by the abort test in `src/lib/assistant.test.ts`.

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
`dates`, `storage` (pagination maths), `useAuth` (write-gate derivation), `theme`,
`askAiContext` (what the assistant is shown, and what is actually sent), `pageTitle`
(the tab format, and that the base names the app rather than the registered
property — which now shares its name, so the distinction is only visible in the
test) and
`assistant` (the NDJSON wire format — a dropped line loses part of an answer
without erroring).

`npm run build` is the primary regression net — `tsc -b` covers both projects.

## Known state

The app has **not** been exercised against a live Supabase project — none was
provisioned during the build. Everything is type-checked, unit-tested, and verified
rendering in a browser (shell, dark mode, `requireAuth` gate, load-error path), but
the read/write round trip and RLS policies are unverified end to end. Do that first.

`.env.local` still holds **placeholder** Supabase values, so no account can be
created and nothing loads or saves. To fix: real URL + anon key, then run
`supabase/setup.sql` → `auth-lockdown.sql` → `add-site-column.sql`, sign up through
the app, and seed the first admin by hand — `handle_new_user` provisions every new
row as `pending`/`is_admin=false`, and the `admin update user_access` policy needs
an existing admin, so the first one is unreachable through the UI.

Until then `VITE_DEV_FORCE_ADMIN=true` forces `isAdmin` and an account email so the
admin nav group and the footer identity render with no backend. It is a
convenience, not a security control — `import.meta.env.DEV` is statically false in
a production build, so a stray flag in a deployed environment does nothing
(verified: the flag name does not appear in `dist/`). `writeGate` is deliberately left alone, so a forced admin
still reads "Sign in to make changes", which is true.

`VITE_DEV_FORCE_FIXTURE=true` is the same idea for data: two weeks of stand-in
snapshots for the registered property, so Home's cards, leaderboard, movers and
dialogs render with real numbers. `devFixture.test.ts` compares its ids against
the registry, so adding a property fails the suite until stand-in rows join it.
Same `DEV` guard, so the same "a stray flag in a deployed environment does
nothing" holds.

Note what that guard does NOT do, because this file asserted otherwise until
2026-08-18: it makes the fixture **inert** in a production build, not **absent**.
Both resolvers read `DEV` off a function parameter, so Rollup cannot prove the
early return and the fixture rows ship in every bundle — `grep -r example.com
dist/` finds them. The behaviour was never wrong; the size claim was. It costs a
few kB, and it is why demo mode costs no bundle size at all.

`VITE_DEMO_MODE=true` is the deployed counterpart: ONE flag that turns on the
fixture and the forced admin together, and forces the auth gate off. It exists
because the deployed demo has no backend whatsoever — no session is obtainable
there, so without it nothing would render. It is deliberately a SEPARATE flag from
the two above rather than a lifted `DEV` guard, and that is the whole point: it is
what keeps "a stray `VITE_DEV_FORCE_*` in a deployed environment does nothing"
true. `resolveRequireAuth` forces the gate off in a demo build rather than
trusting `VITE_REQUIRE_AUTH`, because a demo with the gate left on deploys a login
wall in front of stand-in data — a broken deploy rather than a misconfigured one.
The footer address is `demo@example.com` rather than dev's `dev@localhost`: a
deployed footer reading `dev@localhost` looks like leaked local config.

`MARKET_ORDER` is `['AE']`, an explicit assumption — see §12 of the spec for the
full list of decisions made without confirmation from the requestor.

## Ask AI

Works end to end in dev, verified against a live OpenAI key: streamed replies, a
two-turn thread, the offline state, and a provider failure.

- **`OPENAI_API_KEY` in `.env.local`, no `VITE_` prefix** (invariant 27), plus
  optional `OPENAI_MODEL` (default `gpt-4o`) and `OPENAI_BASE_URL` (Azure or a
  compatible proxy). Env is read once at server start — restart after editing.
- **`vite/askAiProxy.ts`** is the whole server side: `apply: 'serve'`, so it does
  not exist in a production build. `GET /api/ask-ai` is a readiness probe
  answering `{assistant, model}`; `POST` streams NDJSON. The probe insists on a
  JSON content-type because a static host answers an unknown path with
  `index.html` and a 200, which a status-code check reads as success.
- **A deployed build serves the same path from `api/ask-ai.ts`**, a Vercel
  function. Both hosts share `server/askAi.ts` — the provider call and the three
  HTTP-200 failure cases live there once, so dev and production cannot drift
  apart on them. On a host without that function the page reports itself offline,
  which is the probe working as designed. `src/lib/assistant.ts` stays
  provider-blind, so swapping in a Supabase Edge Function later needs no client
  change.
- **Three outcomes arrive with HTTP 200** and are each surfaced rather than read as
  success: a refusal, a `content_filter` finish, and `length` (truncation). On a
  reasoning model, hidden reasoning tokens count against `max_completion_tokens`,
  so truncation can cut the visible answer to nothing.
- **The header does not display the model** (removed by request). The probe still
  reports it, so it is one fetch away for a debug surface, but a typo in
  `OPENAI_MODEL` now surfaces only as a provider error on the first question.
- Accuracy is model-dependent. `gpt-4o-mini` answers correctly against the
  precomputed movers block; asked to derive rankings from the rows itself it named
  the wrong keyword (invariant 29).
- **Two scopes.** The Site picker's first entry is `ALL_SITES`, the default, and
  builds a per-site summary via `buildOverviewContext`; picking a site builds the
  full row-level context. `ALL_SITES` is the empty string, matching the shared
  markup. What makes that safe is the ORDERING, not the literal: `siteById` falls
  back to the default site for an unknown id (invariant 24), so overview mode must
  be decided before any registry lookup — never by asking what `''` resolves to. A
  test asserts the sentinel can never collide with a registered site id.
  Overview mode carries no keyword rows and says so in the context, or the model
  answers keyword questions from a list it never received.
- **The Site picker stays enabled mid-thread**, which is only safe because a turn
  records its `scope` and `buildWireMessages` attaches the data for any scope the
  thread has not seen yet. Do not pin the data to turn one again: switching the
  picker would then relabel the view while every answer kept describing the
  property the thread started on, and a stale answer reads exactly like a current
  one. Covered by the scope-switch tests in `askAiContext.test.ts`.
- **Every figure a reader might ask for is stated in the context, not left to be
  counted.** Invariant 29's rule, and the overview learned it the same way: asked
  "how many sites are tracked?" over a one-site portfolio it answered "ten", having
  read the per-site keyword count as a site count. The header now names the count
  and the sites outright.
- **Starter chips come from `suggestionsFor`**, one set per scope, and every one
  must be answerable from the context it ships with. The sibling dashboard's own
  chips ask about domain rating, PageSpeed, traffic and QA checks — none of which
  exist here — so three of the five were replaced rather than copied. A test
  asserts no suggestion names absent data; keep it that way, or a chip becomes a
  request spent to say "that is not in this import".
- **The mic is Web Speech**, rendered only where a constructor exists (Firefox has
  none). The transcript fills the draft and never auto-sends: recognition mishears,
  and sending would spend a request on the wrong question. Note that Chrome
  implements this by streaming audio to Google's speech service.

## Deployment

Vercel, under the `sandbox` team, from the GitHub repo owned by the sandbox
account. `vercel.json` carries two things: the SPA rewrite (every path to
`index.html`, because routing is client-side and a hard refresh on `/rankings`
would otherwise 404) and a 60-second `maxDuration` for `api/ask-ai.ts` — the
default 10 seconds can cut a long streamed answer off mid-sentence.

The live deployment is a **frontend** demo: `VITE_DEMO_MODE=true`, no Supabase
project behind it. Its environment variables:

| Variable | Value | Why it is needed |
|---|---|---|
| `VITE_SUPABASE_URL` | placeholder URL | `supabase.ts` throws at module load without it, so the app white-screens — even though demo mode never issues a query |
| `VITE_SUPABASE_ANON_KEY` | placeholder | same |
| `VITE_DEMO_MODE` | `true` | fixture data, forced admin, gate off |
| `OPENAI_API_KEY` | real key, **never `VITE_`-prefixed** | invariant 27 — a `VITE_` variable is inlined into the bundle |
| `OPENAI_MODEL` | optional, e.g. `gpt-4o-mini` | defaults to `gpt-4o` |

`VITE_REQUIRE_AUTH` is deliberately absent: `resolveRequireAuth` ignores it in a
demo build.

Those three are set on **Production only**. Vercel CLI 54 cannot target "all
Preview branches" non-interactively — it demands a specific branch name — so a
preview deployment currently white-screens, because `supabase.ts` throws at module
load without the two placeholders. Fix it in the dashboard when you first need a
preview: Settings → Environment Variables → tick Preview. Production is unaffected.

The GitHub repo is connected, so every push to `master` redeploys to production.
`vercel --prod` from a working copy does the same thing without a push.

**The demo's assistant endpoint is unauthenticated.** The gate is off, so
`POST /api/ask-ai` is world-callable and spends whatever key is configured. Give
it a capped or throwaway key — nothing in the app limits who may ask.
