# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run dev       # Vite dev server on localhost:3002 (strictPort)
npm run build     # tsc -b && vite build — the primary regression net
npm test          # vitest run — 317 tests, node environment
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
- BPN ranks API: `docs/integrations/BPN_API.md` — the vendor's reference verbatim,
  plus what we found that contradicts it. Required reading before touching the
  ranking-API import.

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

1. **Import** — TWO sources, one review panel. `UploadModal` offers a spreadsheet or
   a live pull from the BPN ranking API, and both converge on `parseRows`, the pure
   core:
   - **Spreadsheet** — dynamically imports `src/lib/readWorkbook.ts` (the only module
     that touches `xlsx`, ~333 kB, kept out of the initial bundle) and calls
     `parseSheet` → `parseRows`.
   - **Ranking API** — `src/lib/bpnRanks.ts` fetches `/api/bpn-ranks`, then
     `src/lib/bpnRows.ts` maps the vendor rows into the same TABLE shape and calls
     `parseRows` itself. Deliberately not a `Snapshot` built by hand: going through
     the parser inherits dedupe, market ordering, unmatched-keyword collection, date
     detection and grouping, which makes it IMPOSSIBLE for a pull and a file import
     to disagree about any of them rather than merely unlikely.

   Both then land on the same summary, the same editable snapshot date, the same
   duplicate-date warning and the same confirm — so neither is a write path without a
   preview. See invariants 42, 44 and 45, and `docs/integrations/BPN_API.md`.
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
    `ASK_AI_REQUIRE_AUTH` is read in `server/endpointAuth.ts`, and only an exact
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

    Both hosts call `endpointGate` — one function, not two hand-written sequences —
    so the order of authorize-then-limit cannot differ between dev and production.
    Exactly why `server/askAi.ts` already exists on the provider side. That module
    was `askAiAuth.ts` until the ranking import became a second caller; it gates
    BOTH endpoints now and takes an `EndpointFeature` so each one names itself in
    the refusal copy. The env variable keeps its historical name deliberately — ONE
    switch for every gated endpoint, because a second variable is a second chance to
    fail open, and somebody would eventually close one endpoint and leave the other
    anonymous. See invariant 43.

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
39. **`/login` is a PORT of `docs/login-spec.md`, and the spec's §5 outranks its
    §8.** Sign-in only — no sign-up, no reset link, no Google, no monogram — because
    that is what the spec is; accounts are created in the Supabase dashboard.
    The chrome lives in `.login-*` classes in `index.css`, not Tailwind utilities,
    for the reason the `.ask-ai-*` block does: the spec pins exact pixel values and a
    later "tidy-up" of utility soup silently rounds 14px to 12px.
    Three things a re-port will get wrong:
    - **Never hardcode the spec's hexes.** They resolve through `--ref-*` tokens,
      which carry the shell's exact light values and re-point at ours in `.dark`.
      The spec has no dark theme and its literal `#fff` would make this the only
      light-only screen in an app that ships a working one. `--login-page` exists
      because `--ref-neutral-50` maps to `--hover` in dark, a surface tone, which is
      wrong for a page ground.
    - **`.login-error` sets `margin-bottom: 0`, not `margin: 0`.** The spec's §8 uses
      `margin: 0`, which ties on specificity with `.login-form > * + *` and, being
      later, silently wins — collapsing the 12px gap and giving a 320px card where
      §5 documents 332px. The original app is unaffected because Tailwind's real
      `space-y-3` compiles to a higher-specificity selector. §5 is the authority.
    - **The three §11 fixes are applied deliberately**: the submit carries a
      transparent 1px border so it measures 38px like the inputs rather than 36px,
      sets `outline: none` so it draws one focus ring instead of two, and has a
      0.15s hover transition. Do not "restore" the source's behaviour.
    Google sign-in is deliberately ABSENT, and `resolveGoogleAuth` was deleted with
    it rather than left behind describing a control that no longer exists — the
    mistake invariant 22 made. `signInWithOAuth` throws `Unsupported provider` until
    a Google client is configured in the Supabase project, so re-adding the button
    means configuring the provider FIRST, not adding a flag.
40. **Never let an account password reach the CLIENT through the environment.**
    The line is about who can read it, not about which file it sits in — and the
    first version of this invariant drew it in the wrong place, saying "never put a
    password in an env variable" full stop, which `.env.local` now contradicts.

    **Forbidden:** any `VITE_`-prefixed credential. Vite **inlines every `VITE_*`
    value into the client bundle**, so the password would sit in plain text in a JS
    asset any visitor can open in devtools, permanently, in a git-deployed build.
    Invariant 27 with a password instead of an API key, and the worse of the two —
    rotating a leaked provider key costs a minute, whereas a leaked admin password
    has already been indexed. Asked for on 2026-08-19 in the belief it would let
    visitors sign in with the shared account; it would not have, because nothing
    under `src/` reads such a name and the app authenticates through a form.

    **Allowed, and in use:** `ADMIN_EMAIL` / `ADMIN_PASSWORD`, unprefixed, read by
    `scripts/verify-supabase.mjs`, which runs in Node and parses `.env.local` off
    disk itself. That is the `OPENAI_API_KEY` shape — server-side, no `VITE_`, never
    referenced from `src/` — and it is why `npm run verify:supabase` needs no
    arguments. `process.env` still wins over the file so a one-off run can override
    it. Verified by grepping `dist/` for the password, both variable names and the
    address: all absent.

    Two things that follow. Do NOT copy that block into Vercel — the deployment has
    no reader for it, and a live admin password in a hosting dashboard is the leak
    this rule exists to prevent. And do NOT make anything in `src/` read those
    names, which would drag them into the bundle and turn the allowed case into the
    forbidden one.

    A password's real home is still the auth provider. If a shared credential is
    ever meant to be public, print it in the login page's own copy — an intentional
    disclosure of something the reader is supposed to have, rather than a secret
    smuggled through the build. That is NOT the case today: the shared account is
    developer-only, so the login page must not advertise it.

41. **Never open `LoginModal` from a control that has no pending action.** The
    sidebar footer's identity buttons navigate to the `/login` ROUTE, via
    `nextParamFor` — the same URL `AuthGate` builds, so a gated build's behaviour
    is unchanged and signing back in returns the user to the page they left.
    `openLogin` was deleted rather than left unused (invariant 39's rule), so the
    modal is now reachable ONLY through `requireAuth`.

    That split is the whole point. `requireAuth`'s caller is holding a promise
    that has to settle — an Import click captured mid-flight — and navigating
    would throw the action away, so the overlay is right there and only there. A
    deliberate "sign in" captures nothing, and answering it with a modal cost the
    app its one route to `/login`: no address to bookmark, no page title, no
    recovery copy.

    The failure was CONFIG-DEPENDENT, which is why it survived. Sign-out never
    navigated on its own; it called `signOut()` and left the gate to bounce the
    session-less user, and that redirect is behind `REQUIRE_AUTH`, which
    `resolveRequireAuth` forces OFF in a demo build. So on the deployed demo
    nothing moved at all — and because a demo can hold no session, `canSignOut` is
    false and the footer's only identity control is "Sign in", the modal. Reported
    from the live site as "sign out gives me a portal log-in". Both handlers own
    their navigation now instead of inheriting it from whether the gate happens to
    be mounted.

    `await signOut()` BEFORE navigating, and the order is load-bearing: `/login`
    renders `<Navigate to={next} replace />` for anyone still holding a session, so
    navigating first bounces straight back to the dashboard and reads as a dead
    button. Sign-out uses `replace`, sign-in does not — Back must not return to the
    view someone just signed out of, but must return to the page they were
    browsing when they chose to sign in.

    `tsc -b`, `vite build` and all 317 tests passed throughout, before and after.
    Wiring has no unit-test surface here (node environment, no DOM), so this was
    caught and fixed in a browser — invariant 33's lesson again.

42. **Never let a vendor's `position: 0` reach a record.** The BPN panel documents
    `null` for a keyword that is not ranking and sends `0` — 60 of 144 rows on the
    domain this was verified against, on both `position` and `previous_position`,
    with not one `null` among them. Passed through, `0` is not merely wrong, it is
    wrong in the direction that looks like SUCCESS: it is the best rank obtainable,
    so a keyword ranking nowhere sorts ahead of position 1 and lands inside every
    top-N band. Measured on that real pull, untreated it would have reported average
    position **4.03 instead of 6.90**, top-3 **103 instead of 43**, top-10 **137
    instead of 77** and **zero** not-ranking keywords instead of 60.

    `mapPosition` in `src/lib/bpnRows.ts` therefore inverts the test: it accepts only
    a finite number of at least 1 and maps everything else — `0`, negatives, `null`,
    `NaN`, `Infinity`, a non-numeric string — to `'NR'`. Rejecting the known bad
    value instead would be a list to extend every time the vendor invents a new
    spelling.

    The one visible symptom would have been the two panels DISAGREEING, because
    `computeStats` tests `pos >= 1 && pos <= 3` and `computeTiers` tests `pos <= 3`.
    Same screen, 60 apart, and nothing logged.

    `change` is discarded for the same class of reason and is not a separate rule so
    much as the same one: a real row reads `position 0, previous_position 9,
    change 9`, claiming a 9-place improvement for a keyword that left the results.
    Movement is recomputed from the mapped positions, and left EMPTY when either side
    is not a rank — "moved down 5" is not what happens when a keyword vanishes, and
    the distance from nowhere to 5 is not a number.

43. **Never give a shared endpoint gate a second opt-out variable, and never let it
    use one feature's copy for another.** `server/endpointAuth.ts` gates both
    `/api/ask-ai` and `/api/bpn-ranks`. Two things follow, pulling in opposite
    directions, and both matter.

    ONE switch: `ASK_AI_REQUIRE_AUTH` keeps its historical name and is read once for
    every endpoint. A per-endpoint variable doubles the number of ways to fail open
    and guarantees that somebody eventually closes one door and leaves the other
    ajar. The name is stale; that is strictly cheaper than the alternative, and
    renaming it would also invalidate the deployment table below, which records it as
    a variable that must stay ABSENT.

    SEPARATE copy: `endpointGate` takes a required `EndpointFeature`, never a
    default. A signed-out click on Import that answered "Sign in to use the
    assistant" would send the user to investigate a feature they never touched, and
    would read as a bug in that feature rather than as a sign-in prompt for this one.
    Required rather than defaulted precisely so a third endpoint cannot silently
    inherit the assistant's wording. Asserted against a feature that is deliberately
    neither real one, so copy that stopped interpolating fails instead of passing by
    resembling the truth.

44. **Never accept the BPN project id, the action, or the domain from a caller
    without deciding them in `server/bpnRanks.ts`.** All three fail silently if
    trusted.

    `project_id=0` does NOT filter — PHP reads `0` as falsy, drops the condition and
    returns every project the key can see. So a caller who omitted it, or sent `0`,
    or sent anything coercing to `0`, would WIDEN the pull rather than narrow it. It
    is a literal, `18`.

    The action is an ALLOW-LIST of `results` and `domains`, GET only, and `check_all`
    is what it exists for: an hours-long sweep of ~1,727 keywords at ~7s each on a
    single-threaded queue, which nothing in our UI could cancel and a double-click
    would request twice. It is unreachable by two independent means — the function
    exports no POST, and the allow-list refuses the action even over GET.

    The domain is validated as a hostname before it is forwarded, because it is
    interpolated into a URL we then fetch WITH OUR CREDENTIAL ATTACHED. The character
    check is a negated class searched ANYWHERE, not an anchored allow-list: in
    JavaScript `$` also matches immediately before a trailing newline without the `m`
    flag, so `/^[a-z0-9.-]+$/` accepts `"example.com\n"`. Bare IPs are refused by
    requiring an alphabetic TLD — an IP is how a proxy gets aimed at a metadata
    service.

    And the clamps have a coercion trap of their own, tested before anything else:
    `Number(null)` and `Number('')` are both `0`, which is FINITE, so
    `Number.isFinite(n) ? clamp(n) : fallback` reads an ABSENT parameter as zero and
    clamps it to the minimum. For a page size that is one row per page — and one row
    is shorter than a page, so the pagination terminates immediately and the import
    reports success having pulled a single keyword. Absence is tested before any
    coercion.

45. **Never terminate BPN pagination on `meta.total`, and never persist an empty
    pull.** Two separate ways to record a partial week as a complete one.

    Pagination stops on a page SHORTER than the size requested. `meta.total` has been
    reported disagreeing with the array it describes, and `action=domains` reports a
    count of DOMAINS under that same key — so it is a number the vendor computes with
    a different query from the one that filled `data`. (Not reproduced on 2026-08-20;
    recorded as unconfirmed rather than withdrawn, because the defence costs one
    extra request on an exact multiple and removes the whole class.) When the page
    ceiling does stop the walk, the response says `truncated: true` and the modal
    says so too — a truncated pull that looked complete would be committed as the
    week.

    An empty pull THROWS, in `parseBpnRows`, and this is not hypothetical:
    `hazreviews.com` is not in the panel, so every pull for our own property returns
    zero rows today. Persisting that would write a snapshot recording "ranked for
    nothing this week" as a measurement, and it would immediately become the newest
    snapshot every delta on every page is computed against — the damage outlives the
    mistake and looks exactly like data. The message names the domain and says the
    panel may not track it, because the honest diagnosis is "not tracked" and the
    tempting wrong one is "the integration is broken".

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
`endpointAuth` (every default asserted in the CLOSED direction, because the failure
mode of this one is a silent open door that spends money rather than an error, plus
the refusal copy, asserted against a feature that is neither real one so a hardcoded
name cannot pass by resembling the truth) and the two BPN modules:
`bpnRanks` server-side (the allow-list, the absence-before-coercion clamp trap, ten
domain disguises one at a time, the pinned project id, pagination terminating on a
short page while `meta.total` lies, and that NO caller parameter reaches the vendor
except the ones the core chose) and `bpnRows` (the mapping, asserted through
`computeStats`/`computeTiers`/`avgPosition` rather than on cell values — the point is
that the stat cards read correctly, not that a string has a particular shape), with
`bpnRanks` client-side covering the abort rethrow and grepping its own source for the
vendor host, the upstream path and any key prefix.

411 tests. `npm run build` is the primary regression net — `tsc -b` covers both
projects.

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
The three dev-force flags and `ASK_AI_REQUIRE_AUTH` are gone with them. It also
holds `SITES_API_KEY` as of 2026-08-20 — server-side, no `VITE_` prefix, verified
absent from `dist/` along with the vendor host and the upstream path.

**Port 3002 is currently taken by a SIBLING project.** The dev server for
`Online-Casino-Kuwait-Dashboard` was holding it on 2026-08-20, so `npm run dev` here
fails outright — `strictPort` doing its job, which is a genuine collision rather than
a misconfiguration to work around. The comment in `vite.config.ts` lists 3000 and
3001 as the sibling ports and does not know about this one. Either move that project
or run this one with `npx vite --port 3010`; do not quietly reassign the port here,
since 3002 is what the team expects.

**The four steps below are DONE, contrary to what this section claimed until
2026-08-20.** It said the database was still empty and that PostgREST answered
`PGRST205` for every table. That is no longer true, and it is worth being precise
about how it was established rather than asserted: signing in at
`/auth/v1/token?grant_type=password` with the `.env.local` credentials returns a real
access token, and reading `user_access` with that token returns exactly one row —
`status: approved`, `is_admin: true`. Read anonymously the same table returns `[]`,
which is RLS filtering rather than an absent table.

So the schema has run, the auth user exists, it is seeded approved+admin, and
`VITE_REQUIRE_AUTH=true` is set. Note the internal contradiction this resolves: the
"round trip is VERIFIED" paragraph above described importing data through this same
account, which could not have been true of an empty database. When two parts of this
file disagree, check the live project before believing either.

The original sequence is kept below, because it is still the correct recipe for a
FRESH project and none of it is doable from here — DDL needs the service-role key or
the SQL editor:

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
fixture and the forced admin together, and forces the auth gate off. It is NOT in
use any more — production was switched to the real Supabase project on 2026-08-19
and the flag was removed there — so read the rest of this paragraph as what the
flag still DOES, not as a description of what is deployed. It exists for a
deployment with no backend whatsoever, where no session is obtainable and without
it nothing would render. It is deliberately a SEPARATE flag from
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
- **The endpoint authorizes its own callers** — `server/endpointAuth.ts`, shared by
  both hosts through one `endpointGate` call, and shared again with the ranking
  import. A Supabase session is verified by a
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

## BPN ranks API

A second import source beside the spreadsheet, added 2026-08-20 at Ivan's request —
the same integration `BIF-Dashboard` and `Ranking-Reports` already have. Full vendor
reference plus everything we learned the hard way: `docs/integrations/BPN_API.md`.
Read it before touching any of this; the payload is wrong in five ways that do not
error.

**The finding to know first: `hazreviews.com` is NOT in the panel.** It indexes
casino-BRAND domains — 135 of them, `7bitcasino.digital`, `bohocasino.fun`,
`funrize.vip` — not the affiliate site reviewing them. So the integration works end
to end and returns ZERO ROWS for our own property until somebody adds it. That is
data availability, not a bug, and invariant 45's empty-pull guard is what turns it
into a sentence instead of a corrupt snapshot. Use `gulfrecoverygroup.com` (144 rows,
the only non-casino domain in the panel) to see the path work.

- **One core, two thin hosts, one blind client.** `server/bpnRanks.ts` makes every
  decision exactly once — allow-list, pinned project id, clamps, hostname validation,
  timeout, pagination, and the ORDER the gate runs in. `vite/bpnRanksProxy.ts`
  (`apply: 'serve'`) and `api/bpn-ranks.ts` (named `GET` export, invariant 32) are
  signature adapters that read env, call `serveBpnRanks`, and write what it returns.
  They decide nothing, which is what makes dev and production incapable of drifting.
- **The proxy is mandatory for two independent reasons**, either sufficient alone: a
  `VITE_`-prefixed key would be readable in devtools (invariant 27), and the vendor is
  a third-party origin so a direct browser call is refused by CORS anyway.
- **`SITES_API_KEY`, no `VITE_` prefix**, travelling to the vendor in an
  `Authorization: Bearer` header rather than a query string, so it stays out of
  upstream access logs. Env is read once at server start — restart after editing.
- **The gate is the assistant's gate**, `endpointGate`, with its own
  `EndpointFeature` so the refusal says "Sign in to import ranking data." (invariant
  43). Ungated this is an open proxy onto 135 other properties' rankings billed to our
  key. `GET` with no `action` is the readiness probe and stays open, for the same
  reason Ask AI's does: a signed-out page must be able to explain a disabled control.
- **The UI is the EXISTING import modal**, a second source tab feeding the same review
  panel, editable snapshot date and confirm. A separate refresh dialog would have been
  the only write path in the app with no preview.
- **Verified against the live upstream on 2026-08-20** — anonymous, forbidden action,
  invalid domain, wrong method, our own domain and a domain the panel holds, plus a
  real multi-page walk. Statuses are tabulated in the integration doc.

## Deployment

Vercel, under the `sandbox` team, from the GitHub repo owned by the sandbox
account. `vercel.json` carries two things: the SPA rewrite (every path to
`index.html`, because routing is client-side and a hard refresh on `/rankings`
would otherwise 404) and a 60-second `maxDuration` for **both** functions —
`api/ask-ai.ts`, where the default 10 seconds can cut a long streamed answer off
mid-sentence, and `api/bpn-ranks.ts`, where one pull can be several sequential
upstream requests at up to 20 seconds each.

**DEMO MODE WAS RETIRED on 2026-08-19.** The live deployment is now the REAL
gated app, pointed at Supabase project `lplcodzxneqbubzsgfnv` — the same one
`.env.local` uses. It is no longer a public frontend demo, and this section
described one until that date. Its environment variables:

| Variable | Value | Why it is needed |
|---|---|---|
| `VITE_SUPABASE_URL` | real project URL | the data path; `supabase.ts` throws at module load without it and the app white-screens |
| `VITE_SUPABASE_ANON_KEY` | real anon key | same. Public by design and inlined into the bundle — RLS is what protects the data (invariant 10) |
| `VITE_REQUIRE_AUTH` | `true` | the whole app sits behind sign-in plus admin approval |
| `OPENAI_API_KEY` | absent today | Ask AI reports itself offline until one is added, which is the probe working as designed |
| `OPENAI_MODEL` | optional, e.g. `gpt-4o-mini` | defaults to `gpt-4o` |
| `SITES_API_KEY` | real BPN key, set on Production 2026-08-20 | the ranking-API import. SERVER-SIDE ONLY, no `VITE_` prefix (invariant 27) — it reaches a third-party panel holding 135 domains belonging to other properties. Without it the import modal's Ranking API tab reports itself unavailable and says why; the spreadsheet source is unaffected |
| `ASK_AI_REQUIRE_AUTH` | **ABSENT**, and must stay absent | absence means REQUIRED (invariant 34), and it now gates BOTH endpoints (invariant 43) — so leaving it behind on a real deployment would reopen an anonymous OpenAI proxy AND an anonymous proxy onto the vendor's whole panel. It was `false` under demo mode because a demo can hold no session |

`VITE_DEMO_MODE` is **gone**, not set to `false`. Only the exact string `'true'`
enables it, so either works — but an absent flag cannot be misread by whoever
edits this next.

Two traps if you ever set these again. `vercel env add` reads the value from
STDIN, and **piping it in silently stores an empty string** — the variable is
created, `vercel env ls` shows it as "Encrypted", and the deploy white-screens
because `supabase.ts` throws with no URL. Use a redirect from a file
(`vercel env add NAME production < file`) and never trust the "Added" line alone.
Then note that `vercel env pull` **cannot read encrypted values back** — it writes
`NAME=""` for every one of them, which looks exactly like the empty-value bug and
is not. The only honest check is the built artefact: deploy, then grep the live
JS asset for the project ref. That is how both states above were told apart.

Those are set on **Production only**, and a preview deployment therefore still
white-screens because `supabase.ts` throws at module load without the two Supabase
values. Fix it in the dashboard when you first need a preview: Settings →
Environment Variables → tick Preview. Production is unaffected.

One correction to what this section said before 2026-08-20: CLI 54 **can** target all
Preview branches non-interactively, and it tells you how — `vercel env add NAME
preview` refuses to prompt and prints `vercel env add NAME preview --value <value>
--yes` as the way to do it. `SITES_API_KEY` was still added to Production only, and
deliberately: `--value` puts the secret on the command line, where it lands in shell
history and in any process listing, which is a worse exposure than the stdin trap
this paragraph exists to warn about. There is nothing to gain by it either while
preview deployments cannot render at all.

The GitHub repo is connected, so every push to `master` redeploys to production.
`vercel --prod` from a working copy does the same thing without a push.

**The assistant endpoint authorizes its own callers** as of 2026-08-19, so it is no
longer world-callable — see invariant 34. With demo mode retired the deployment can
finally present a real session, so `ASK_AI_REQUIRE_AUTH` stays absent and the gate
does its job; the old advice to set it `false` applied to the demo only and must
not be carried forward. Adding `OPENAI_API_KEY` is what turns Ask AI on there, and
that is the moment the endpoint can start spending: the
rate limit is per-instance and in memory, so the only hard spend ceiling is a cap
set on the key at the provider.

**`api/bpn-ranks.ts` has not been deployed yet.** `SITES_API_KEY` is set on
Production, but the function reaching it is only on the `feat/bpn-ranks-import`
branch, so nothing on the live site serves that path today — the deployed page would
report the import unavailable, which is the probe working as designed. Note that
`vercel env ls` showing the variable proves nothing about its VALUE: `vercel env pull`
cannot read encrypted values back, so the only honest check is behavioural, and here
it is a good one — hit the deployed `/api/bpn-ranks` with no `action` after merging.
`{"ranks":"ready"}` means the key is non-empty; `{"ranks":"unconfigured"}` means the
stdin trap above swallowed it. That is the same "read the write row, not the read row"
discipline `verify:supabase` uses, and it costs one anonymous GET because the probe
is deliberately ungated.
