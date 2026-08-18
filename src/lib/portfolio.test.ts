import { describe, expect, it } from 'vitest'
import type { RankingRecord, Snapshot } from '../types'
import {
  computePortfolioMovers,
  computeSiteLeaderboard,
  latestWeek,
  portfolioKeywords,
} from './portfolio'
import { SITES, type Site } from './sites'

/**
 * A second site, injected rather than registered. Only one site is configured, so
 * without this the cross-site assertions below (ranking order, totals summing,
 * mover attribution) would all collapse to a single row and stop proving
 * anything. `registry` exists on these functions for exactly this reason.
 */
const KWT_SITE: Site = {
  id: 'onlinecasinokuwait',
  name: 'OnlineCasinoKuwait',
  domain: 'onlinecasinokuwait.com',
  slug: 'kuwait',
  color: '#12A150',
}
const TWO_SITES: Site[] = [...SITES, KWT_SITE]

function rec(keyword: string, position: string, market = 'AE'): RankingRecord {
  return {
    keyword,
    market,
    position,
    previous: '',
    change: '',
    urlFound: '',
    searchVolume: '',
    date: '',
  }
}

function snap(site: string, rawDate: string, records: RankingRecord[]): Snapshot {
  return { id: `snap-${site}-${rawDate}`, site, rawDate, displayDate: rawDate, records }
}

// Newest first, which is the order Layout guarantees.
const HAZ_NEW = snap('hazreviews', '2026-08-13', [
  rec('haz casino', '1'),
  rec('haz bonus', '3'),
  rec('haz slots', '9'),
  rec('haz live', '14'),
  rec('haz poker', 'NR'),
])
const HAZ_OLD = snap('hazreviews', '2026-08-06', [
  rec('haz casino', '2'),
  rec('haz bonus', '3'),
  rec('haz slots', '15'),
  rec('haz live', '11'),
  rec('haz poker', 'NR'),
])
const KWT_NEW = snap('onlinecasinokuwait', '2026-08-13', [
  rec('kuwait casino', '4'),
  rec('kuwait bonus', '25'),
])
const KWT_OLD = snap('onlinecasinokuwait', '2026-08-06', [
  rec('kuwait casino', '2'),
  rec('kuwait bonus', '25'),
])
const ALL = [HAZ_NEW, KWT_NEW, HAZ_OLD, KWT_OLD]

describe('latestWeek', () => {
  it('takes the newest raw date across every property', () => {
    expect(latestWeek(ALL)).toBe('2026-08-13')
  })

  // Ordering by created_at or by array position would let one property's stale
  // import claim to be the latest week.
  it('is unaffected by array order', () => {
    expect(latestWeek([KWT_OLD, HAZ_NEW, HAZ_OLD])).toBe('2026-08-13')
  })

  it('is null with no snapshots', () => {
    expect(latestWeek([])).toBeNull()
  })
})

describe('portfolioKeywords', () => {
  // Counts DISTINCT keywords in each property's newest snapshot only. Summing
  // every snapshot would multiply the total by the number of weeks imported.
  it('counts distinct keywords across the newest snapshot per property', () => {
    expect(portfolioKeywords(ALL)).toBe(7)
  })

  it('does not double-count a keyword tracked in two markets', () => {
    const twoMarkets = snap('hazreviews', '2026-08-13', [
      rec('haz casino', '1', 'AE'),
      rec('haz casino', '4', 'KW'),
    ])
    expect(portfolioKeywords([twoMarkets])).toBe(1)
  })

  it('is zero with no snapshots', () => {
    expect(portfolioKeywords([])).toBe(0)
  })
})

describe('computeSiteLeaderboard', () => {
  it('ranks by Top-10 count, best first', () => {
    const { rows } = computeSiteLeaderboard(ALL, TWO_SITES)
    expect(rows.map((r) => r.site.id)).toEqual(['hazreviews', 'onlinecasinokuwait'])
    expect(rows.map((r) => r.top10)).toEqual([3, 1])
  })

  // Cumulative, matching computeTiers: p1 counts inside top3, which counts
  // inside top10. Treating them as exclusive buckets makes every column wrong.
  it('reports cumulative tiers', () => {
    const haz = computeSiteLeaderboard(ALL, TWO_SITES).rows[0]
    expect({ p1: haz.p1, top3: haz.top3, top10: haz.top10 }).toEqual({ p1: 1, top3: 2, top10: 3 })
  })

  // A total is the sum of the per-property counts. Recomputing it from a merged
  // record list would double-count a keyword both properties happen to track.
  it('totals each column across properties', () => {
    const { totals } = computeSiteLeaderboard(ALL, TWO_SITES)
    expect(totals).toEqual({ p1: 1, top3: 2, top10: 4, keywords: 7 })
  })

  it('uses only the newest snapshot per property', () => {
    // HAZ_OLD has 'haz slots' at 15, outside the top 10. If old snapshots leaked
    // in, top10 would exceed 3.
    expect(computeSiteLeaderboard(ALL, TWO_SITES).rows[0].top10).toBe(3)
  })

  it('reports a rank delta against the previous snapshot', () => {
    const { rows } = computeSiteLeaderboard(ALL, TWO_SITES)
    // Previously haz had 2 in the top 10 and kuwait 1, so the order is unchanged.
    expect(rows[0].rankDelta).toBe(0)
  })

  it('reports a null rank delta when a property has only one snapshot', () => {
    const { rows } = computeSiteLeaderboard([HAZ_NEW, KWT_NEW], TWO_SITES)
    expect(rows.every((r) => r.rankDelta === null)).toBe(true)
  })

  // A property in the registry with nothing imported must still appear, at zero,
  // rather than vanishing — otherwise "2 properties" contradicts a 1-row table.
  it('omits a property with no snapshots rather than inventing rows', () => {
    const { rows } = computeSiteLeaderboard([HAZ_NEW], TWO_SITES)
    expect(rows.map((r) => r.site.id)).toEqual(['hazreviews'])
  })

  it('returns nothing for no snapshots', () => {
    expect(computeSiteLeaderboard([], TWO_SITES).rows).toEqual([])
  })
})

describe('computePortfolioMovers', () => {
  it('separates climbers from droppers', () => {
    const { up, down } = computePortfolioMovers(ALL, 6, TWO_SITES)
    expect(up.map((m) => m.keyword)).toEqual(['haz slots', 'haz casino'])
    // Ordered by size of move: haz live 11->14 is 3, kuwait casino 2->4 is 2.
    expect(down.map((m) => m.keyword)).toEqual(['haz live', 'kuwait casino'])
  })

  // Lower is better, so 15 -> 9 is a climb of 6, not -6.
  it('reports the delta as a positive magnitude for a climb', () => {
    const { up } = computePortfolioMovers(ALL, 6, TWO_SITES)
    expect(up[0]).toMatchObject({ keyword: 'haz slots', from: 15, to: 9, delta: 6 })
  })

  it('sorts each list by the size of the move', () => {
    const { up, down } = computePortfolioMovers(ALL, 6, TWO_SITES)
    expect(up.map((m) => m.delta)).toEqual([6, 1])
    expect(down.map((m) => m.delta)).toEqual([3, 2])
  })

  // Looked up by keyword rather than by index, so the assertion survives a
  // change to the sort without silently checking the wrong row.
  it('carries the property so a mover can be attributed', () => {
    const { up, down } = computePortfolioMovers(ALL, 6, TWO_SITES)
    expect(down.find((m) => m.keyword === 'kuwait casino')?.site.id).toBe('onlinecasinokuwait')
    expect(up.find((m) => m.keyword === 'haz slots')?.site.id).toBe('hazreviews')
  })

  // An unchanged position is not a mover, and NR has no numeric position to
  // compare, so neither may appear in either list.
  it('ignores unchanged positions and unranked keywords', () => {
    const all = [...computePortfolioMovers(ALL, 6, TWO_SITES).up, ...computePortfolioMovers(ALL, 6, TWO_SITES).down]
    expect(all.map((m) => m.keyword)).not.toContain('haz bonus')
    expect(all.map((m) => m.keyword)).not.toContain('haz poker')
  })

  it('respects the limit', () => {
    expect(computePortfolioMovers(ALL, 1, TWO_SITES).up).toHaveLength(1)
  })

  it('is empty when a property has only one snapshot', () => {
    expect(computePortfolioMovers([HAZ_NEW, KWT_NEW], 6, TWO_SITES)).toEqual({ up: [], down: [] })
  })
})
