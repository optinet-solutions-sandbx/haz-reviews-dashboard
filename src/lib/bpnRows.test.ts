import { describe, expect, it } from 'vitest'
import { emptyPullMessage, parseBpnRows } from './bpnRows'
import { computeStats, computeTiers, avgPosition, parsePosition } from './normalize'

/**
 * The vendor→parser mapping.
 *
 * Everything here is a case where trusting the payload produces confident wrong
 * NUMBERS rather than an error, which is why the assertions run through
 * `computeStats` and `computeTiers` as well as the records: the point is not that a
 * cell holds a particular string, it is that the stat cards read correctly.
 */

const SITE = 'hazreviews'

/** A live row shape, verbatim from the panel — including the fields it does NOT send. */
const row = (over: Record<string, unknown> = {}) => ({
  domain: 'gulfrecoverygroup.com',
  keyword: 'trading scam recovery',
  country: 'AE',
  language: 'ar',
  position: 5,
  previous_position: 7,
  change: 2,
  url_found: 'https://gulfrecoverygroup.com/recovery',
  checked_at: '2026-08-17 03:29:21',
  project_id: 18,
  ...over,
})

const parse = (rows: unknown[]) => parseBpnRows(rows, 'gulfrecoverygroup.com', SITE)
const only = (rows: unknown[]) => parse(rows).snapshot.records[0]

// ─── position: 0 ─────────────────────────────────────────────────────────────

/**
 * THE ONE THAT INFLATES EVERY STAT CARD.
 *
 * `0` passed through is the best rank there is: it sorts ahead of position 1, falls
 * inside every top-N band, and pulls the average down. The vendor documents `null`
 * here and sends `0` — 60 of 144 rows on the domain this was verified against.
 */
describe('position 0 means not ranking', () => {
  it('maps 0 to the not-ranking sentinel, not to rank zero', () => {
    expect(only([row({ position: 0 })]).position).toBe('NR')
    expect(parsePosition(only([row({ position: 0 })]).position)).toBe('NR')
  })

  it('maps the same on previous_position', () => {
    expect(only([row({ previous_position: 0 })]).previous).toBe('NR')
  })

  /**
   * The disguises, in one decision. The rule is "accept only a real rank" rather
   * than "reject the known bad value", so the next spelling the vendor invents is
   * refused too instead of being a surprise.
   */
  it('maps every non-rank to the sentinel', () => {
    for (const value of [0, -1, -99, null, undefined, NaN, Infinity, '', 'n/a', {}, []]) {
      expect(only([row({ position: value })]).position, JSON.stringify(value)).toBe('NR')
    }
  })

  it('keeps a real rank, including one arriving as a string', () => {
    expect(only([row({ position: 1 })]).position).toBe('1')
    expect(only([row({ position: 88 })]).position).toBe('88')
    expect(only([row({ position: '12' })]).position).toBe('12')
  })

  /**
   * The actual damage, measured. Three keywords ranking nowhere and one at position
   * 2: the tiers must show one top-3 and three NR. Untreated, `0` would report four
   * top-3 keywords, an average position of 0.5, and no NR at all.
   */
  it('keeps the stat cards and tiers honest', () => {
    const records = parse([
      row({ keyword: 'a', position: 0, previous_position: 0 }),
      row({ keyword: 'b', position: 0, previous_position: 0 }),
      row({ keyword: 'c', position: 0, previous_position: 0 }),
      row({ keyword: 'd', position: 2, previous_position: 2 }),
    ]).snapshot.records

    expect(computeStats(records)).toMatchObject({ total: 4, notRanking: 3, top3: 1 })
    expect(computeTiers(records)).toMatchObject({ nr: 3, top3: 1, top10: 1 })
    expect(avgPosition(records)).toBe(2)
  })
})

// ─── change ──────────────────────────────────────────────────────────────────

describe('change is recomputed, never trusted', () => {
  /**
   * The live row that proves the field unusable: position 0, previous 9, change 9.
   * Read literally that is "improved by 9" for a keyword that left the results.
   */
  it('discards a change that contradicts its own positions', () => {
    const record = only([row({ position: 0, previous_position: 9, change: 9 })])
    expect(record.position).toBe('NR')
    // Not '+9', not '9', not '-9'. Nothing moved by a number here.
    expect(record.change).toBe('')
    expect(computeStats([record])).toMatchObject({ notRanking: 1, improved: 0, dropped: 0 })
  })

  it('computes an improvement from the mapped positions', () => {
    // 7 → 5 is two places better, whatever the vendor said.
    expect(only([row({ position: 5, previous_position: 7, change: -99 })]).change).toBe('+2')
    expect(computeStats([only([row({ position: 5, previous_position: 7 })])])).toMatchObject({
      improved: 1,
    })
  })

  it('computes a drop', () => {
    expect(only([row({ position: 9, previous_position: 4, change: 5 })]).change).toBe('-5')
    expect(computeStats([only([row({ position: 9, previous_position: 4 })])])).toMatchObject({
      dropped: 1,
    })
  })

  it('leaves an unchanged position with no movement token', () => {
    expect(only([row({ position: 3, previous_position: 3, change: 1 })]).change).toBe('')
    expect(computeStats([only([row({ position: 3, previous_position: 3 })])])).toMatchObject({
      unchanged: 1,
      top3: 1,
    })
  })

  /**
   * A number here would be a fabrication in both directions: the distance from
   * nowhere to 5 is not 5, and a keyword that vanished did not "move down".
   */
  it('emits nothing when one side of the comparison is not a rank', () => {
    expect(only([row({ position: 5, previous_position: 0 })]).change).toBe('')
    expect(only([row({ position: 0, previous_position: 5 })]).change).toBe('')
  })

  /**
   * Plain signed integers, deliberately not the parenthesised `▲ (n)` grammar whose
   * number means the PREVIOUS position rather than a delta. `effectiveDelta` carries
   * a special case for that form, and there is no reason to go near it when we are
   * the ones writing the string.
   */
  it('never emits the parenthesised previous-position grammar', () => {
    const record = only([row({ position: 5, previous_position: 7 })])
    expect(record.change).not.toContain('(')
    expect(record.change).not.toMatch(/[▲▼↑↓]/)
  })
})

// ─── search volume ───────────────────────────────────────────────────────────

describe('search volume', () => {
  /**
   * The vendor sends no volume field of any name. Empty is what lets carry-forward
   * inherit last week's figure; a zero would assert that we measured none.
   */
  it('is left empty so carry-forward can inherit it', () => {
    expect(only([row()]).searchVolume).toBe('')
  })

  it('stays empty even if the vendor starts sending something unexpected', () => {
    expect(only([row({ search_volume: 2400, volume: '2.4K' })]).searchVolume).toBe('')
  })
})

// ─── dates ───────────────────────────────────────────────────────────────────

describe('checked_at', () => {
  it('reads the live space-separated form', () => {
    expect(only([row({ checked_at: '2026-08-17 03:29:21' })]).date).toBe('2026-08-17')
  })

  /**
   * The vendor's own documented form. Taken as text: building a `Date` from it and
   * reading a local getter shifts the day in half the world's timezones, and this
   * value decides which snapshot a whole week belongs to (invariant 8).
   */
  it('reads the documented ISO-with-zone form without shifting the day', () => {
    expect(only([row({ checked_at: '2026-07-29T09:00:00Z' })]).date).toBe('2026-07-29')
    // The failure this guards is off-by-one, so assert the boundary that would move.
    expect(only([row({ checked_at: '2026-07-29T00:30:00Z' })]).date).toBe('2026-07-29')
    expect(only([row({ checked_at: '2026-07-29T23:30:00Z' })]).date).toBe('2026-07-29')
  })

  it('is empty for anything unparseable, rather than guessing', () => {
    for (const value of [null, undefined, 'yesterday', 17, '']) {
      expect(only([row({ checked_at: value })]).date, JSON.stringify(value)).toBe('')
    }
  })

  /**
   * One pull spans several check dates, because the panel re-checks on its own
   * schedule. The parser picks the modal date, and the import modal lets the user
   * override it — inherited behaviour, asserted here because it is the first time
   * the input is guaranteed to be mixed rather than merely able to be.
   */
  it('takes the most frequent date as the snapshot date', () => {
    const result = parse([
      row({ keyword: 'a', checked_at: '2026-08-17 01:00:00' }),
      row({ keyword: 'b', checked_at: '2026-08-17 02:00:00' }),
      row({ keyword: 'c', checked_at: '2026-07-27 03:00:00' }),
    ])
    expect(result.detectedDate).toBe('2026-08-17')
    expect(result.snapshot.id).toBe('snap-hazreviews-2026-08-17')
  })
})

// ─── the empty pull ──────────────────────────────────────────────────────────

/**
 * The guard that turns "hazreviews.com is not in the panel" from silent corruption
 * into a sentence. An empty snapshot would record "ranked for nothing this week" as
 * measured fact and then become the newest snapshot every delta is computed
 * against — so the damage outlives the mistake and looks exactly like data.
 */
describe('an empty pull', () => {
  it('throws instead of producing a snapshot', () => {
    expect(() => parse([])).toThrow(/no keywords/i)
  })

  it('names the domain and says why nothing was imported', () => {
    const message = emptyPullMessage('hazreviews.com')
    expect(message).toContain('hazreviews.com')
    expect(message).toContain('Nothing was imported')
    // The diagnosis a reader needs, since the tempting wrong one is "the code is
    // broken" when the real answer is "the panel does not track this domain".
    expect(message).toMatch(/tracked in the panel/i)
  })
})

// ─── the parser round trip ───────────────────────────────────────────────────

/**
 * The correspondence between this module's header names and the parser's column
 * aliases is the thing most likely to break, and it cannot break loudly: a header
 * the parser does not recognise resolves to column -1 and yields an empty cell, so
 * every affected value silently becomes `''`. Only a round trip catches it.
 */
describe('the parser round trip', () => {
  it('resolves every column it writes', () => {
    const record = only([
      row({
        keyword: 'live blackjack uae',
        country: 'QA',
        position: 4,
        previous_position: 6,
        url_found: 'https://example.com/p',
        checked_at: '2026-08-11 10:00:00',
      }),
    ])
    expect(record).toEqual({
      keyword: 'live blackjack uae',
      market: 'QA',
      position: '4',
      previous: '6',
      change: '+2',
      urlFound: 'https://example.com/p',
      searchVolume: '',
      date: '2026-08-11',
    })
  })

  /** Inherited, not reimplemented: an unlisted market is reported, never dropped. */
  it('reports an unlisted market rather than discarding the row', () => {
    const result = parse([
      row({ keyword: 'a', country: 'AE' }),
      row({ keyword: 'b', country: 'QA' }),
      row({ keyword: 'c', country: 'SA' }),
    ])
    expect(result.snapshot.records).toHaveLength(3)
    expect(result.markets.sort()).toEqual(['AE', 'QA', 'SA'])
    expect(result.unknownMarkets.sort()).toEqual(['QA', 'SA'])
  })

  it('falls back to the default market when the vendor sends none', () => {
    expect(only([row({ country: null })]).market).toBe('AE')
  })

  /** Also inherited: a keyword with no group is surfaced, not silently binned. */
  it('collects keywords that match no group', () => {
    const result = parse([row({ keyword: 'zzz totally unmatched phrase' })])
    expect(result.unmatchedKeywords).toEqual(['zzz totally unmatched phrase'])
  })

  it('skips and counts a row with no keyword instead of importing a blank', () => {
    const result = parse([row({ keyword: 'real' }), row({ keyword: '' }), row({ keyword: null })])
    expect(result.snapshot.records).toHaveLength(1)
    expect(result.skippedRows).toBe(2)
  })

  it('stamps the snapshot with the site it was imported for', () => {
    expect(parse([row()]).snapshot.site).toBe(SITE)
  })

  /**
   * Dedupe is the parser's, on keyword + market. Verified against the live panel on
   * 2026-08-20: (domain, keyword, country) is unique across all 1,922 rows, so
   * nothing is lost today. Asserted anyway so the behaviour is known rather than
   * discovered — the panel tracks four languages, and one keyword checked in one
   * country in two languages would collapse to the later row.
   */
  it('collapses two rows sharing a keyword and market, keeping the last', () => {
    const result = parse([
      row({ keyword: 'same', country: 'AE', position: 3 }),
      row({ keyword: 'same', country: 'AE', position: 8 }),
    ])
    expect(result.snapshot.records).toHaveLength(1)
    expect(result.snapshot.records[0].position).toBe('8')
  })

  /** A row that is not an object at all must not crash the import. */
  it('survives a malformed row', () => {
    const result = parse([row({ keyword: 'real' }), null, 'nonsense', 42])
    expect(result.snapshot.records).toHaveLength(1)
    expect(result.skippedRows).toBe(3)
  })
})
