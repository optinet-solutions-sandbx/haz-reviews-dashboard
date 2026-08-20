/**
 * Vendor rows → the TABLE the spreadsheet parser already consumes.
 *
 * This module deliberately stops one step short of a snapshot. It produces a header
 * row plus data rows and hands them to `parseRows`, exactly as `readWorkbook.ts`
 * does for an .xlsx file, because everything downstream of that call is behaviour we
 * want to inherit rather than reimplement:
 *
 *   - dedupe on keyword + market, last write wins
 *   - market ordering, with unlisted markets appended rather than dropped
 *   - unmatched-keyword collection, so a keyword with no group is REPORTED
 *   - snapshot-date detection by modal value, and the id that makes re-import
 *     idempotent
 *   - group resolution at render time, never stored (invariant 16)
 *
 * Building a `Snapshot` here instead would duplicate all of it, and the failure mode
 * of duplicating it is the worst available: an API pull and a file import of the same
 * week would disagree about totals, grouping or dates, with each looking perfectly
 * plausible on its own screen. Going through one parser makes that disagreement
 * impossible rather than unlikely.
 *
 * See docs/integrations/BPN_API.md for what the vendor gets wrong. Two of those five
 * are handled here, and both are cases where trusting the payload produces confident
 * wrong numbers instead of an error.
 */
import type { ParseResult } from '../types'
import { parseRows } from './parser'

/**
 * The sentinel `parsePosition` recognises as "we looked and it was not there", as
 * opposed to `''`, which means "we never looked". A keyword the panel checked and
 * did not find is the former.
 */
const NOT_RANKING = 'NR'

/**
 * Header names chosen to hit the parser's EXACT aliases, not its prefix fallbacks.
 *
 * `resolveColumns` tries exact matches across every alias before it tries any
 * prefix, so exact names make column resolution independent of the order the aliases
 * happen to be listed in. A test parses a real table through `parseRows` rather than
 * asserting this array, because the thing that can break is the correspondence
 * between the two files — and only a round trip tests that.
 *
 * `Search Volume` is present and always empty on purpose: the vendor returns no
 * volume of any kind, and an empty cell is what lets carry-forward inherit the value
 * from an earlier snapshot. A zero would instead assert that we measured no volume.
 */
const HEADER = [
  'Keyword',
  'Country',
  'Position',
  'Previous',
  'Change',
  'URL Found',
  'Search Volume',
  'Last Check',
] as const

interface RawRow {
  keyword?: unknown
  country?: unknown
  position?: unknown
  previous_position?: unknown
  url_found?: unknown
  checked_at?: unknown
}

/**
 * THE MOST DANGEROUS FIELD IN THE PAYLOAD.
 *
 * The vendor documents `null` for a keyword that is not ranking. Live data returns
 * `0`, and often — 60 of 144 rows on the domain this was verified against, on both
 * `position` and `previous_position`, with not one `null` among them.
 *
 * Passed through untouched, `0` is not merely wrong; it is wrong in the direction
 * that looks like success. It is the BEST rank obtainable, so a keyword ranking
 * nowhere sorts ahead of position 1, counts inside every top-N tier, and drags the
 * average position down. Every stat card reads better than reality and nothing
 * anywhere reports a problem.
 *
 * So the rule is inverted from "reject the known bad value" to "accept only a real
 * rank": anything that is not a finite number of at least 1 is not-ranking. That
 * covers `0`, negatives, `null`, `undefined`, `NaN`, `Infinity` and a non-numeric
 * string in one decision, rather than enumerating the disguises the vendor has shown
 * us so far and being surprised by the next one.
 */
function mapPosition(value: unknown): string {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return NOT_RANKING
  return String(Math.trunc(n))
}

/**
 * Movement, RECOMPUTED — the vendor's `change` is discarded unread.
 *
 * A real row reads `position: 0, previous_position: 9, change: 9`, which says
 * "improved by 9" about a keyword that left the results entirely. There is no way to
 * repair that field, because it disagrees with the two numbers it is supposedly
 * derived from, so the only safe use of it is none.
 *
 * Emitted as a plain signed integer, which `parseChange` reads directly. Notably NOT
 * the parenthesised `▲ (9)` form, whose number means the PREVIOUS position rather
 * than a delta — `effectiveDelta` has a special case for it and there is no reason to
 * go anywhere near that grammar when we control the string.
 *
 * A missing delta is left EMPTY rather than filled with zero, in the two cases where
 * a number would be a fabrication:
 *
 *   - a keyword that dropped out (`5` → NR). "Moved down 5" is not what happened;
 *     it left the results, which the position column already says.
 *   - a keyword that newly appeared (NR → `5`). The distance from nowhere to 5 is
 *     not a number.
 *
 * Both are counted as not-ranking or unchanged by `computeStats` on the position
 * alone, so an empty token costs no accuracy — and it keeps the badge honest instead
 * of painting a green arrow on a keyword that vanished.
 */
function mapChange(position: string, previous: string): string {
  if (position === NOT_RANKING || previous === NOT_RANKING) return ''
  const delta = Number(previous) - Number(position)
  if (delta === 0) return ''
  return delta > 0 ? `+${delta}` : String(delta)
}

/** Leading `YYYY-MM-DD` only. */
const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2})/

/**
 * Takes the calendar date the vendor wrote, as text, with no timezone conversion.
 *
 * `checked_at` arrives as `'2026-08-17 03:29:21'` in live data and as
 * `'2026-07-29T09:00:00Z'` in the vendor's own example. Both start with the date, so
 * a text slice reads both — and, more to the point, it never constructs a `Date`.
 * That is invariant 8: `new Date('2026-07-29T09:00:00Z')` followed by any local
 * getter shifts the day in one half of the world's timezones, and this value decides
 * which snapshot a whole week of rankings belongs to.
 *
 * A stated assumption rather than a certainty: the panel checks Gulf markets and
 * stamps its own clock, so its calendar date is treated as authoritative. Converting
 * it to the viewer's zone would be a guess dressed as precision.
 */
function mapDate(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = ISO_PREFIX.exec(value.trim())
  return match ? match[1] : ''
}

function mapText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The message an empty pull produces, and the reason it is an error at all.
 *
 * Zero rows means the panel holds nothing for this domain — which for
 * `hazreviews.com` is the expected answer today, because the domain is not in the
 * panel at all. Persisting that would write a snapshot recording "ranked for
 * nothing this week" as a measured fact, and it would immediately become the newest
 * snapshot every delta on every page is computed against. The damage outlives the
 * mistake and looks like data.
 *
 * So the pull throws, and the message says which domain and what to do about it,
 * because the honest diagnosis is "the panel does not track this" and the tempting
 * wrong one is "the integration is broken".
 */
export function emptyPullMessage(domain: string): string {
  return (
    `The ranking panel returned no keywords for ${domain}. ` +
    'Nothing was imported — an empty snapshot would record "ranked for nothing" as a ' +
    'measurement and every later comparison would be made against it. ' +
    'Check that the domain is tracked in the panel.'
  )
}

/**
 * Vendor rows in, `ParseResult` out — the same type a spreadsheet produces, so the
 * review panel, the date override and the confirm path are shared verbatim.
 *
 * Throws on zero rows (see above) and lets `parseRows` throw for anything else,
 * which keeps every import error surfacing in one place in the UI.
 */
export function parseBpnRows(rows: unknown[], domain: string, siteId: string): ParseResult {
  if (rows.length === 0) throw new Error(emptyPullMessage(domain))

  const table: unknown[][] = [[...HEADER]]

  for (const raw of rows) {
    const r = (raw ?? {}) as RawRow
    const position = mapPosition(r.position)
    const previous = mapPosition(r.previous_position)

    table.push([
      mapText(r.keyword),
      // Empty is fine: the parser fills in MARKET_ORDER[0] rather than dropping the
      // row, and an unlisted market is appended rather than discarded (invariant 17).
      mapText(r.country),
      position,
      previous,
      mapChange(position, previous),
      // `url_found` is null on every non-ranking row. Left empty and NOT carried
      // forward — only searchVolume inherits, because a ranking URL can legitimately
      // vanish and inheriting one would assert that a page ranked when the panel
      // said nothing.
      mapText(r.url_found),
      '',
      mapDate(r.checked_at),
    ])
  }

  // One note on what the parser's dedupe does to this input. It keys on
  // keyword + market, so two rows sharing both would collapse to the last one.
  // Verified against the live panel on 2026-08-20: (domain, keyword, country) is
  // unique across all 1,922 rows it holds, so nothing is being lost today. It is not
  // a guarantee though — the panel tracks four languages, and the day it checks one
  // keyword in one country in two languages, the pull will quietly keep one of them.
  // The visible symptom would be a keyword count lower than the panel's own, which
  // is why `rowCount` is surfaced next to the parsed record count in the UI.
  return parseRows(table, siteId)
}
