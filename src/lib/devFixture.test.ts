import { describe, expect, it } from 'vitest'
import { resolveDevFixture } from './devFixture'
import { computePortfolioMovers, computeSiteLeaderboard, portfolioKeywords } from './portfolio'
import { SITES } from './sites'

const on = { DEV: true, VITE_DEV_FORCE_FIXTURE: 'true' }

describe('resolveDevFixture', () => {
  // Same load-bearing guard as devOverrides: a stray flag in a deployed
  // environment must not conjure fake ranking data into a real dashboard.
  it('is ignored outside a dev build even when the flag is set', () => {
    expect(resolveDevFixture({ DEV: false, VITE_DEV_FORCE_FIXTURE: 'true' })).toBeNull()
  })

  it('is off unless the flag is exactly true', () => {
    expect(resolveDevFixture({ DEV: true })).toBeNull()
    expect(resolveDevFixture({ DEV: true, VITE_DEV_FORCE_FIXTURE: '' })).toBeNull()
    expect(resolveDevFixture({ DEV: true, VITE_DEV_FORCE_FIXTURE: '1' })).toBeNull()
  })

  it('keeps meta consistent with the snapshots it ships', () => {
    const f = resolveDevFixture(on)!
    expect(f.meta.map((m) => m.id)).toEqual(f.snapshots.map((s) => s.id))
  })

  it('derives display dates rather than hard-coding them', () => {
    const f = resolveDevFixture(on)!
    expect(f.snapshots[0].displayDate).toBe('13 Aug 26')
  })
})

// The point of a fixture is to light up every branch of the page. These assert
// it actually does — a fixture where nothing dropped would leave the Droppers
// list unrendered, and the bug that hides it undiscovered.
describe('the fixture exercises the Home page', () => {
  const { snapshots } = resolveDevFixture(on)!

  // Every snapshot must belong to a REGISTERED site. A fixture referencing a
  // de-registered id would resolve to the default and inflate its figures.
  it('covers every registered site across two weeks', () => {
    expect(new Set(snapshots.map((s) => s.site))).toEqual(new Set(SITES.map((s) => s.id)))
    expect(new Set(snapshots.map((s) => s.rawDate)).size).toBe(2)
  })

  it('produces a non-zero keyword count', () => {
    expect(portfolioKeywords(snapshots)).toBeGreaterThan(0)
  })

  it('produces every leaderboard tier as a non-zero number somewhere', () => {
    const { totals } = computeSiteLeaderboard(snapshots)
    expect(totals.p1).toBeGreaterThan(0)
    expect(totals.top3).toBeGreaterThan(totals.p1)
    expect(totals.top10).toBeGreaterThan(totals.top3)
  })

  it('produces BOTH climbers and droppers', () => {
    const { up, down } = computePortfolioMovers(snapshots)
    expect(up.length).toBeGreaterThan(0)
    expect(down.length).toBeGreaterThan(0)
  })

  /**
   * Per property, not just in the roll-up. A fixture where only one site moved
   * would satisfy the portfolio assertion above and still leave the movers panel
   * empty on every other property's page — which looks like a broken panel rather
   * than like flat rankings.
   */
  it.each(SITES.map((s) => [s.name, s.id]))('moves in both directions on %s', (_name, id) => {
    const forSite = snapshots.filter((s) => s.site === id)
    const { up, down } = computePortfolioMovers(forSite)
    expect(up.length).toBeGreaterThan(0)
    expect(down.length).toBeGreaterThan(0)
  })
})
