# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run dev       # Vite dev server on localhost:3002 (strictPort)
npm run build     # tsc -b && vite build — the primary regression net
npm test          # vitest run — 320 tests, node environment
npm run test:watch

# Checks a LIVE Supabase project, reading .env.local. Add ADMIN_PASSWORD=... to
# include the account checks. Verifies behaviour rather than configuration —
# see below on why the write probe is the check that matters.
npm run verify:supabase
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
34. **Never let the assistant endpoint's authorization default to open.**
    `ASK_AI_REQUIRE_AUTH` is read in `server/askAiAuth.ts`, and only an exact
    `'false'` opts out — absence means REQUIRED. A required check with no Supabase
    settings behind it refuses too, rather than falling through to allowed.
    Both directions matter, because the app's own gate cannot cover this endpoint:
    `requireAuth` is client-side (invariant 10 — RLS is the boundary) and RLS does
    not extend to an OpenAI endpoint, so with no server-side check anyone who knows
    the URL can POST an arbitrary `system` prompt plus arbitrary `messages` and bill
    it to `OPENAI_API_KEY`. An anonymous OpenAI proxy, not a dashboard feature.
    Inverting the default is the same shape of mistake as a firewall that fails
    open: one forgotten variable on one deploy and the door is unlocked, with
    nothing in the UI to show it — whereas a wrongly-locked endpoint says
    "Sign in to use the assistant" on the first question.

    Verification is ONE PostgREST read of the caller's own `user_access` row, which
    is why there is no separate JWT step: PostgREST validates the signature and
    expiry itself, RLS resolves `auth.uid()` so the row cannot be someone else's,
    and the row carries `status` — so a signed-in but still-`pending` account is
    refused in the same round trip. Send the bearer token AND the `apikey`; the anon
    key alone resolves `auth.uid()` to null, returns zero rows, and reads as
    "nobody is approved".

    Both hosts call `askAiGate` — one function, not two hand-written sequences — so
    the order of authorize-then-limit cannot differ between dev and production.
    Exactly why `server/askAi.ts` already exists on the provider side.

    The rate limit is in memory, per instance. That makes it a speed bump against
    one signed-in account burning the budget, NOT a spend ceiling: a deployed
    function scales to many instances and resets on every cold start, so the real
    allowance is the limit times however many are warm. The only hard ceiling is a
    capped key at the provider. Say that where the limiter is defined rather than
    letting a reader infer a guarantee it cannot give.

    `GET` stays open deliberately. It reports only whether a key is configured, and
    gating it would leave a signed-out page unable to explain why the composer is
    disabled.
35. **Never put `/login` or `/reset-password` inside `AuthGate`.** They are
    declared as siblings of the gated layout route in `App.tsx`, and the gate is
    now part of that route's `element` rather than a wrapper around `<Routes>` —
    which is what made a sign-in page impossible to add before. Each fails a
    different way if moved back inside. `/login` becomes unreachable: the gate
    renders its own decision instead of the matched route, so the redirect to
    `/login` resolves to a route that never renders. `/reset-password` fails more
    quietly and is the one to watch — the emailed recovery link establishes a
    REAL session, so the gate waves the user through to the dashboard and the
    screen the email promised never appears. That was the shipped behaviour until
    2026-08-19: `sendPasswordReset` pointed at a route that did not exist, the
    catch-all bounced the user to Home, and nothing anywhere said so.
36. **Never navigate to a `next` parameter without `safeNextPath`.** It arrives
    from the address bar. Checking `startsWith('/')` is NOT enough — `//evil.com`
    and `/\evil.com` both pass it and both navigate off-site, the second because
    browsers normalise a backslash in the authority position. A control character
    is a third route in, because the browser strips a tab from `java\tscript:`
    *after* a naive check has already looked at the string and seen nothing
    alarming. The payoff for an attacker is the highest-value moment in the app:
    a user who has just typed a password, handed to a page that can ask for it
    again. `safeNextPath` also refuses to return a sign-in path, or signing in
    would land the user back on the portal and read as a failed attempt. Every
    case is in `authRedirect.test.ts`.
37. **Never let `recoveryFromUrl`'s result be recomputed after mount.** It is read
    once, in a `useState` initialiser. supabase-js consumes the recovery fragment
    and strips it from the URL as the client initialises, so anything reading
    `window.location` later sees a bare path and concludes there was never a
    token — turning a valid link into "nothing to reset".
    Its `message` is a REASON FRAGMENT with no terminal punctuation, because the
    screen joins it onto its own guidance sentence and Supabase's
    `error_description` arrives in that shape. A fallback written as a finished
    sentence concatenates into prose that reads as two authors; asserted in the
    tests rather than left to whoever edits the copy next.
38. **Never derive a sign-out affordance from the displayed email.** Use
    `getIdentityGate`: the ADDRESS may be forced by `VITE_DEV_FORCE_EMAIL`, and
    rendering it with no backend is the entire point of that flag, but a SESSION
    cannot be forced. The sidebar footer originally chose between "signed in, here
    is Sign out" and "Sign in" by asking whether it had an address to show, so a
    forced identity selected the signed-in branch with nothing behind it. The
    resulting click was the quietest possible failure: `supabase.auth.signOut()`
    short-circuits when there is no session, so there was **no request, no error,
    no console warning and no state change** — and the identity it appeared to
    control was a module-load constant that no runtime call could ever clear.
    Reported as "the sign-out button is broken"; it was doing the only thing
    available to it. `tsc -b`, the build and all 314 tests passed throughout.
    The same trap is waiting for `isAdmin`, which `DEV_OVERRIDE` also forces:
    anything gated on a forced value must not offer an action that only a real
    session can perform. Note what is deliberately NOT done here — the fix does
    not make `signOut` clear the override. `DEV_OVERRIDE` is resolved once at
    module load precisely so a production build cannot be talked into it at
    runtime; making it mutable to fix a button would trade invariant-grade safety
    for cosmetics.
39. **Never render "Continue with Google" unless `VITE_ENABLE_GOOGLE_AUTH=true`.**
    `resolveGoogleAuth` is the one env flag here that is opt-IN, because its
    failure direction is reversed: `signInWithOAuth` throws `Unsupported provider`
    until a Google OAuth client is configured in the Supabase project. A portal
    with no Google button reads as "this app uses passwords"; one with a button
    that errors reads as "this app is broken" — on the first screen a new user
    ever sees. A demo build forces it off for the same reason it forces the gate
    off: there is no Supabase project there to configure.
40. **Never put an account password in an env variable.** Asked for on
    2026-08-19 as `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`, on the reasonable-
    sounding theory that it would let visitors sign in with the shared admin
    account. It cannot work, in two stacked ways, and both are worth knowing
    because the request will recur.

    First, it does nothing: no code here reads those names, and an env variable
    has never created a Supabase user. Only Supabase Auth does. Adding the lines
    yields a password sitting in a file next to an account that still does not
    exist.

    Second, and worse, the obvious repair is the actual disaster. For credentials
    to reach a sign-in form they must reach the browser, which means a `VITE_`
    prefix, which means Vite **inlines them into the client bundle** — the admin
    password lands in plain text in a JS asset that anyone can read in devtools,
    permanently, in a git-deployed build. Invariant 27 with a password instead of
    an API key, and the worse of the two, because rotating a leaked provider key
    costs a minute while a leaked admin password has already been indexed.

    A password's only home is the auth provider. If a shared credential is meant
    to be public, print it in the login page's own copy — that is an intentional
    disclosure of a value the reader is supposed to have, not a secret smuggled
    into a bundle. `OPENAI_API_KEY` is the shape to copy: server-side, no `VITE_`,
    never referenced from `src/`.

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
`dates`, `storage` (pagination maths), `useAuth` (write-gate AND identity-gate derivation), `theme`,
`askAiContext` (what the assistant is shown, and what is actually sent), `pageTitle`
(the tab format, and that the base names the app rather than the registered
property — which now shares its name, so the distinction is only visible in the
test) and
`assistant` (the NDJSON wire format — a dropped line loses part of an answer
without erroring).
`authRedirect` (the `next` parameter's open-redirect defences, each disguise
asserted separately, plus the three recovery-link states) and
`askAiAuth` (every default asserted in the CLOSED direction, because the failure
mode of this one is a silent open door that spends money rather than an error).

`npm run build` is the primary regression net — `tsc -b` covers both projects.

## Known state

**The round trip is VERIFIED as of 2026-08-19.** This section said the opposite from
the build until that date — the app had never touched a live Supabase project. It has
now, against `lplcodzxneqbubzsgfnv`, driven in a browser with `VITE_REQUIRE_AUTH=true`
and no dev-force flags:

- Signed out, `/hazreviews/rankings` redirects to `/login?next=%2Fhazreviews%2Frankings`;
  signing in returns to that exact page.
- The footer shows the real `admin@dashboard.com`, and the admin nav group appears
  from the database's own `is_admin`, not a forced flag.
- An 8-row xlsx imported, persisted, and survived a full reload — so `upsertSnapshot`,
  `loadRecentSnapshots` and the RLS policies all work. `live blackjack uae` grouped as
  Live Casino rather than Jack.com, which is the word-boundary rule holding on real data.
- `logActivity` wrote its audit row.
- **Sign out ends the session**, and the gate bounces the user back to the portal.

Two findings from doing it, both invisible until real data existed:

1. `activity_log` is **append-only by RLS** — `auth-lockdown.sql` grants read and
   insert and nothing else, so no one can delete or edit an audit entry, through the
   API or otherwise. A DELETE answers `204` having removed nothing, because RLS
   filtered the row rather than refusing the statement. That is correct and worth
   knowing before someone reads that 204 as a successful deletion.
2. A counted PostgREST request (`limit=0` + `Prefer: count=exact`) is a RANGE
   request, so it answers **206** as soon as the table holds anything and 200 only
   while empty. `verify-supabase.mjs` originally checked for 200 and therefore passed
   on an empty database and failed on a populated one — exactly backwards. It checks
   `res.ok` now.

The test snapshot was deleted afterwards, so the tables are empty again apart from the
one permanent audit row and the single `user_access` row.

**Carry-forward is verified too**, with two real snapshots in the database. Week 2
omitted volume and URL for two keywords: the view showed the inherited `2.4K` while
the STORED row still read `search_volume: ""`, which is invariant 2 holding — the
inheritance is derived at render time and never persisted. Deltas computed across
snapshots (`1▲ (2)`). Note that only `searchVolume` carries forward, by design: a
ranking URL can legitimately vanish week to week, so inheriting one would assert a
page ranked when the export said nothing. The `—` in that column is correct, not a gap.

That test also surfaced a real defect, now fixed: **the only import control lived in
`EmptyState`**, so a site could ingest a first week and then never a second — fatal
to a tracker whose whole purpose is comparing weeks, and invisible until a second
import was attempted. `PageHeader` grew an `action` slot and the Rankings header
carries an Import button. (Invariant 22 already described "the Import button" and its
`aria-label`; that button did not exist anywhere in `src/` at the time, so the
invariant was documenting a control that had been lost.)

Still unexercised: `loadOlderSnapshots` (nothing beyond the newest 8 has existed),
the 1,000-row pagination in `loadSnapshotRecords` (invariant 1 — needs more than
1,000 records to mean anything), and every admin action in `AdminUsers` beyond
reading one's own row.

**As of 2026-08-19 `.env.local` holds REAL credentials** for project
`lplcodzxneqbubzsgfnv`, and the client provably reaches it: a sign-in attempt
returns Supabase's own `Invalid login credentials` rather than `Failed to fetch`.
The three dev-force flags and `ASK_AI_REQUIRE_AUTH` are gone with them.

What is NOT done: **the database is still empty** — PostgREST answers `PGRST205`
(`Could not find the table 'public.user_access'`) for every table, so no SQL has
run. Remaining, in order, and none of it doable from here because DDL needs the
service-role key or the SQL editor:

1. Run `supabase/setup.sql` → `auth-lockdown.sql` in the SQL editor.
   `add-site-column.sql` is a **no-op on a fresh install** — its own header says so
   and `setup.sql` already creates the `site` column. Harmless to run; note that
   the pre-2026-08-19 instruction to always run all three overstated it.
2. Create the auth user with **Auto Confirm ticked** (Authentication → Users → Add
   user). Not via sign-up: the account is `admin@dashboard.com` and nobody owns
   `dashboard.com`, so no confirmation mail can be delivered.
3. Seed it approved+admin by hand. `handle_new_user` provisions every new row as
   `pending`/`is_admin=false`, and the `admin update user_access` policy needs an
   existing admin, so the first one is unreachable through the UI.
4. Only then set `VITE_REQUIRE_AUTH=true`. Doing it earlier locks the dashboard
   behind a sign-in nothing can satisfy.

**Verify with `npm run verify:supabase`, and read the WRITE row, not the read row.**
The script probes behaviour with the same anon key the browser ships, because a
policy can be present and still permissive — configuration and behaviour come
apart. One subtlety is load-bearing: `setup.sql`'s interim policies are
`for all using (true) with check (true)` with **no `TO` clause**, which defaults to
`PUBLIC` and so includes `anon`. On an EMPTY database a signed-out *read* returns
`[]` whether or not `auth-lockdown.sql` ran, so the read check cannot tell the two
apart and deliberately reports "no rows yet" rather than PASS. The *write* probe
can, and does: it posts a `ranking_records` row whose `snapshot_id` violates the
foreign key, and Postgres evaluates RLS before the FK trigger fires — `42501` means
RLS refused, `23503` means RLS **allowed** it and only the constraint intervened.
Nothing is ever written; the FK violation aborts the statement. Do not "simplify"
that probe into a plain insert, and do not upgrade the read check to PASS on zero
rows.

A note on that account, because it is unusual and a future session will otherwise
try to "fix" it. It is ONE SHARED credential with full admin, and that is
deliberate: it is shared **within the admin/developer group only**, as a team ops
login. Not a public or stakeholder credential. An earlier version of this section
said it was meant for "anyone who has the app's link" — that was a misreading,
corrected 2026-08-19, and the distinction is the whole reason full admin is the
right level here rather than a mistake to undo.

Two consequences follow from it being shared at all, neither a blocker:
`activity_log` attributes every action to `admin@dashboard.com`, so the audit trail
records what happened but not which developer did it; and the password cannot be
rotated for one person, so a departure means rotating for everyone. Per-person
accounts are the fix if either ever matters — `handle_new_user` plus an admin
approval already supports them.

It must NOT be advertised on the login page. That was floated while the credential
was believed to be public, where printing it would have been an intentional
disclosure; for a developer-only login it is simply a leak. Credentials are not
stored in this repo or in any env file either — see invariant 40 on why an
`ADMIN_PASSWORD` variable cannot work.

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
- **The endpoint authorizes its own callers** — `server/askAiAuth.ts`, shared by
  both hosts through one `askAiGate` call. A Supabase session is verified by a
  single PostgREST read of the caller's own `user_access` row, which also refuses a
  `pending` or `revoked` account, plus a per-user rate limit. `ASK_AI_REQUIRE_AUTH`
  opts out on an exact `'false'` and nothing else; absence means required. See
  invariant 34, including why the in-memory limiter is a speed bump rather than a
  spend ceiling. `.env.local` sets the opt-out today only because the Supabase
  values there are placeholders, so no session can be obtained — delete that line
  once they are real, and the gate gets exercised locally before it matters live.
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
| `ASK_AI_REQUIRE_AUTH` | `false` on a demo; ABSENT on a real deployment | a demo has no session to verify, so its assistant only works with the endpoint's own gate opted out — and since absence means required, a real deployment sets nothing at all (invariant 34) |

`VITE_REQUIRE_AUTH` is deliberately absent: `resolveRequireAuth` ignores it in a
demo build.

Those three are set on **Production only**. Vercel CLI 54 cannot target "all
Preview branches" non-interactively — it demands a specific branch name — so a
preview deployment currently white-screens, because `supabase.ts` throws at module
load without the two placeholders. Fix it in the dashboard when you first need a
preview: Settings → Environment Variables → tick Preview. Production is unaffected.

The GitHub repo is connected, so every push to `master` redeploys to production.
`vercel --prod` from a working copy does the same thing without a push.

**The assistant endpoint authorizes its own callers** as of 2026-08-19, so it is no
longer world-callable — see invariant 34. Two things still follow from that rather
than being solved by it. A demo build has no session to present, so a demo that
wants a working assistant has to set `ASK_AI_REQUIRE_AUTH=false` and is then
spending on anonymous callers again: give that deployment a capped or throwaway
key, or leave it with no key at all and let the page report itself offline. And the
rate limit is per-instance and in memory, so the only hard spend ceiling is a cap
set on the key at the provider.
