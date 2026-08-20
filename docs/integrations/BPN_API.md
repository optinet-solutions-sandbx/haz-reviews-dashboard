# BPN Ranks API

Two documents in one file, deliberately.

**Part 1 is the vendor's own quick-start, reproduced verbatim.** Do not correct it,
even where our own testing contradicts it — its value is being an unedited record of
what we were told, so a future disagreement with the panel can be settled by
pointing at it.

**Part 2 is what we actually found**, and it is the part to trust. Where the two
disagree, Part 2 wins, and every item there was observed against the live upstream
rather than reasoned about. Append to it as you learn more.

---

# Part 1 — Vendor reference (verbatim)

# Ranks API — Quick Start

**Base URL:** `https://3213211.xyz/bpn-panel-cc/api/ranks.php`

---

## Step 1 — Get an API Key

Go to **Settings → API Keys** in the panel, click **Generate Key**, copy it immediately (shown once).

Your key looks like: `bpn_a1b2c3d4e5f6...`

---

## Step 2 — Pull data

All filters are optional. Add them to narrow results.

### Get all keywords + rankings for one domain
```
GET /api/ranks.php?action=results&domain=example.com&api_key=bpn_YOUR_KEY
```

### Get all tracked domains (with keyword counts)
```
GET /api/ranks.php?action=domains&api_key=bpn_YOUR_KEY
```

### Get everything (all domains, all keywords)
```
GET /api/ranks.php?action=results&api_key=bpn_YOUR_KEY
```

### Get rank history for a domain
```
GET /api/ranks.php?action=history&domain=example.com&api_key=bpn_YOUR_KEY
```

### Trigger a full project rank-check sweep (async, for unattended automation)
Requires a key with "Can trigger checks" enabled.
```
POST /api/ranks.php?action=check_all&api_key=bpn_YOUR_KEY
Content-Type: application/json

{ "project_id": 18 }
```
Returns instantly: `{ "ok": true, "run_id": 42, "status": "queued", "total_jobs": 1727 }`
Full-project sweeps take a few hours (single-threaded queue, ~7s/keyword) — poll `run_status`, don't hold the connection open.

### Poll a triggered run until it's done
```
GET /api/ranks.php?action=run_status&run_id=42&api_key=bpn_YOUR_KEY
```
`status` becomes `complete` when done. Calling `check_all` again while a run is still in progress just returns the same `run_id` — it won't start a second sweep.

---

## What you get back

```json
{
  "ok": true,
  "meta": { "total": 12, "limit": 100, "offset": 0 },
  "data": [
    {
      "domain":            "example.com",
      "keyword":           "online casino",
      "country":           "US",
      "position":          5,
      "previous_position": 7,
      "change":            2,
      "url_found":         "https://example.com/casino",
      "checked_at":        "2026-07-29T09:00:00Z"
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `position` | Current rank (null = not in top results) |
| `previous_position` | Rank from the previous check |
| `change` | Positive = moved up, negative = dropped |

---

## Optional filters

Append any of these to any request:

| Param | Example | Effect |
|-------|---------|--------|
| `domain` | `domain=example.com` | Only this domain |
| `keyword` | `keyword=online casino` | Only this keyword |
| `country` | `country=GB` | Only this ISO country (real country the check ran against, e.g. GB = checked via google.co.uk) |
| `language` | `language=en` | Only this language (this is what `country` used to mean — use this to keep old filtering behavior) |
| `from` | `from=2026-07-01` | History from this date |
| `to` | `to=2026-07-31` | History up to this date |
| `limit` | `limit=500` | Max rows (default 100, max 1000) |
| `offset` | `offset=100` | Skip first N rows (for paging) |

> **Changed 2026-08-10:** `country` used to actually return/filter by language (`en`/`de`/`it`/`ar`). It now returns the real ISO country. If your integration filters `country=en`, switch it to `language=en`.

---

## Using a header instead of query param

If you'd rather not put the key in the URL:

```
Authorization: Bearer bpn_YOUR_KEY
```

---

## Errors

```json
{ "ok": false, "error": "Invalid or revoked API key.", "code": 401 }
```

| Code | Reason |
|------|--------|
| 401 | Missing or invalid key |
| 403 | Key scoped to a different project |
| 400 | Unknown action |

---

# Part 2 — What we found

Everything below was observed against the live upstream on **2026-08-20** with our
own key, project 18. Where it contradicts Part 1, this is the version that holds.

## The finding that shapes the whole feature

**`hazreviews.com` is not in the panel.** `action=domains` returns 135 domains and
none of them matches `haz` or `review`. They are casino-BRAND domains
(`7bitcasino.digital`, `bohocasino.fun`, `funrize.vip`, …) — this panel indexes the
properties being reviewed, not the affiliate site reviewing them.

So a pull for our own property returns **zero rows**, and will keep doing so until
somebody adds `hazreviews.com` to the panel. That is a data-availability fact and
not a broken integration: read the empty-pull rule below before concluding the code
is wrong.

The only non-casino domain in the list is `gulfrecoverygroup.com` (84 keywords, 144
rows), which is what every claim here was verified against. Use it when you need to
see the path work end to end.

## The vendor data is wrong in five ways that do not error

### 1. `position: 0` means NOT RANKING

Part 1 says `null`. Live data says `0`, and often: **60 of 144 rows** on
`gulfrecoverygroup.com` are `position: 0`, and **71** are `previous_position: 0`.
Not one row was `null`.

This is the single most dangerous field in the payload, because `0` is not merely
wrong — it is wrong in the direction that looks like success. Passed through
untouched it is the BEST rank obtainable: a keyword ranking nowhere sorts ahead of
position 1, counts inside every top-N tier, and pulls the average position down.
Every stat card reads better than reality with nothing anywhere reporting a
problem.

`src/lib/bpnRows.ts` maps `0`, negatives, non-finite values and `null` all to the
not-ranking sentinel. Test the sentinel, never the source value — CLAUDE.md
invariant 9.

### 2. `change` contradicts its own positions

A real row, verbatim:

```json
{ "keyword": "خسرت اموالي في البورصة", "position": 0, "previous_position": 9, "change": 9 }
```

Read literally that is "improved by 9" for a keyword that **left the results
entirely**. The field is unusable. It is discarded on import and movement is
recomputed from the mapped positions instead — which is also the only way an API
pull and a spreadsheet import can agree about what moved.

### 3. `meta.total` cannot be used to terminate pagination

We could NOT reproduce the reported 135-for-154 mismatch on 2026-08-20 — see
"Still unconfirmed" at the end of this file for the three probes and for what the
two numbers most likely were. Recorded as **unconfirmed rather than fixed**: the
earlier sighting is not withdrawn, and a handful of clean probes is not evidence
that the field is trustworthy.

What is definitely true is that the vendor computes this number with a query of its
own: `action=domains` reports `total: 135`, which is a count of DOMAINS, under the
same key that carries a row count elsewhere. Any caller reading `meta.total` as a row
budget is trusting a figure that need not describe the array beside it.

Either way the defence is the same and costs nothing: paginate until a page comes
back **shorter than the limit requested**. Never terminate on a reported count.

### 4. `project_id=0` does not filter — it returns everything

PHP treats `0` as falsy, so the parameter is dropped and the response carries every
project the key can see. The project id is therefore pinned as a literal in
`server/bpnRanks.ts` and is never accepted from a caller: a caller that omits it,
or sends `0`, or sends a string that coerces to `0`, must not be able to widen the
pull.

### 5. No search volume is returned at all

The row keys are exactly:

```
change, checked_at, country, domain, keyword, language, position, previous_position,
project_id, url_found
```

There is no volume field of any name. The mapping leaves the column empty so
carry-forward can inherit it from an earlier snapshot (CLAUDE.md invariant 3 — an
empty cell is inheritable, a zero is a measurement).

`url_found` is `null` on every non-ranking row (all 60 of them), which is correct
and must not be carried forward: a ranking URL can legitimately vanish, and
inheriting one would assert that a page ranked when the export said nothing.

## Two more things the payload does that need handling

**`country` is a real ISO country now, and there are six of them.**
`gulfrecoverygroup.com` returns `AE, BH, KW, OM, QA, SA`, all with `language: "ar"`.
Our `MARKET_ORDER` is `['AE']`, so the other five arrive as unknown markets — which
the parser appends and reports rather than dropping (invariant 17). Note the
2026-08-10 vendor change in Part 1: `country` used to mean language. Anything
filtering `country=en` is filtering on a value that no longer exists.

**One pull mixes several check dates.** `gulfrecoverygroup.com` spans
`2026-07-27`, `2026-08-10`, `2026-08-11` and `2026-08-17` in a single response,
because the panel re-checks keywords on its own schedule rather than in one sweep.
The parser's `modal()` picks the most frequent date for the snapshot, and the import
modal's date field is there to correct it. This is inherited behaviour, not new: a
spreadsheet export with a stale row does the same thing.

## Boundaries we impose on our side

- **`check_all` is unreachable.** The allow-list is `results` and `domains`, GET
  only. A sweep is ~1,727 keywords at ~7s each on a single-threaded queue — hours
  of work that nothing in our UI could cancel, started by a double-click.
- **`domain` is validated as a hostname before it is forwarded.** It is
  interpolated into a URL we then fetch **with our credential attached**, so a
  scheme, an authority, a path or a second query string could aim that
  credentialled request somewhere else.
- **An empty pull throws instead of writing a snapshot.** Zero rows means the panel
  holds nothing for that domain. Persisting it records "ranked for nothing this
  week" as measured fact, and then becomes the newest snapshot every delta is
  computed against — so the damage outlives the mistake. This is the rule that
  turns the `hazreviews.com` finding above from a corruption into a clear message.
- **The key never reaches the browser.** `SITES_API_KEY` is server-side only, with
  no `VITE_` prefix (invariant 27), and travels to the vendor in an `Authorization:
  Bearer` header rather than a query string so it stays out of upstream access
  logs. `src/lib/bpnRanks.ts` knows our own endpoint path and nothing else — not
  the vendor host, not the key, not the upstream action names.

## Where the code lives

| File | What it owns |
|---|---|
| `server/bpnRanks.ts` | every decision, exactly once: allow-list, pinned project id, clamps, hostname validation, timeout, pagination |
| `vite/bpnRanksProxy.ts` | dev host — `apply: 'serve'`, so it does not exist in a build |
| `api/bpn-ranks.ts` | deployed host — named `GET` export (see CLAUDE.md invariant 32) |
| `server/endpointAuth.ts` | the shared session gate, also used by Ask AI |
| `src/lib/bpnRanks.ts` | browser client; knows only `/api/bpn-ranks` |
| `src/lib/bpnRows.ts` | vendor rows → the table shape `parseRows` already consumes |

## Verified against the live upstream — 2026-08-20

Driven through our own endpoint on a dev server, signed in as the real
`admin@dashboard.com` session with `ASK_AI_REQUIRE_AUTH` absent (so the gate was
live, not opted out).

| Case | Status | Body |
|---|---|---|
| readiness probe, anonymous, no `action` | `200` | `{"ranks":"ready"}` |
| `action=domains`, anonymous | `401` | `Sign in to import ranking data.` |
| `action=check_all`, authorized | `403` | `Action 'check_all' is not allowed. Allowed: results, domains.` |
| `action=history`, authorized | `403` | same shape |
| `domain=https://evil.com/x?api_key=y` | `400` | `… is not a valid domain. Expected a bare hostname such as example.com.` |
| `domain=169.254.169.254` | `400` | same |
| `POST ?action=check_all` | `405` | `This endpoint only accepts GET.` |
| `DELETE ?action=domains` | `405` | same |
| `action=results&domain=hazreviews.com` | `200` | `rowCount: 0`, `rows: []` |
| `action=results&domain=gulfrecoverygroup.com` | `200` | `rowCount: 144`, `pages: 1` |
| same, `limit=50` | `200` | `rowCount: 144`, `pages: 3` — the walk really walks |

Note the first two rows together: the probe is open and the data path is not, which is
the split described above working as intended.

The `check_all` refusal arrives from two independent directions. `POST` is refused
before anything else looks at the query, and the allow-list refuses the action even
over `GET` — so widening one of them would not be enough to reach a sweep.

### The mapped result, from real rows

144 vendor rows through `parseBpnRows` → `parseRows`:

```
vendor rows:       144      parsed records: 144   (nothing lost to dedupe)
detected date:     2026-08-17  → snap-hazreviews-2026-08-17
markets:           AE, QA, BH, KW, OM, SA   (5 reported as unknown, none dropped)
stats:  total 144 · top3 43 · improved 15 · dropped 8 · notRanking 60 · unchanged 61
tiers:  p1 17 · top3 43 · top10 77 · page2 3 · nr 60
avg position:      6.90
rows claiming rank "0":                0
NR rows carrying a movement token:     0
records with a non-empty search volume: 0
```

**What trusting `position: 0` would have produced instead**, on this exact data:

| Figure | Mapped | Untreated | Why |
|---|---|---|---|
| average position | **6.90** | 4.03 | 60 zeros averaged in as rank 0 |
| tiers, top 3 | **43** | 103 | `0 <= 3` is true |
| tiers, top 10 | **77** | 137 | same |
| tiers, NR | **60** | 0 | `0` is a number, so never NR |

Every one of those is a better-looking number and not one of them would have logged a
warning. Note that `computeStats`' own `top3` happens to survive because it tests
`pos >= 1 && pos <= 3`, while `computeTiers` tests `pos <= 3` — so the two panels
would have disagreed with each other by 60, on the same screen, and that
disagreement would have been the only visible symptom.

All 144 keywords landed in the **Other** group, correctly: they are Arabic
trading-recovery phrases for a domain that has nothing to do with the casino keyword
registry. Surfaced as `unmatchedKeywords`, not discarded (invariant 17).

### Still unconfirmed

`meta.total` disagreeing with `data.length` did not reproduce on 2026-08-20. Three
probes all agreed: `144/144` for one domain, `1922/1922` unfiltered, and `154/154`
for `language=ar` — that last one is interesting, because **154 is exactly the row
count from the original sighting**, and `135` is the panel's domain count. So the
earlier report was most likely a `language`-filtered pull whose `total` was computed
by the unfiltered query, and the vendor appears to have fixed it (the 2026-08-10
`country`/`language` change is in the right area).

The short-page rule stays regardless. It costs one extra request on an exact multiple
and removes a whole class of silent truncation, and "we could not reproduce it today"
is not "it cannot happen".
