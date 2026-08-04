import { describe, expect, it } from 'vitest'
import {
  GROUPS,
  GROUP_BY_SLUG,
  MARKET_ORDER,
  OTHER_GROUP,
  groupForKeyword,
  groupSlug,
  orderMarkets,
} from './groups'

describe('groupSlug', () => {
  it('strips everything that is not alphanumeric', () => {
    expect(groupSlug('Lucky7Even')).toBe('lucky7even')
    expect(groupSlug('BC.Game')).toBe('bcgame')
    expect(groupSlug('Wild.io')).toBe('wildio')
    expect(groupSlug('Live Casino')).toBe('livecasino')
  })
})

describe('registry integrity', () => {
  it('has unique slugs', () => {
    const slugs = GROUPS.map((g) => groupSlug(g.name))
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('indexes every group by slug', () => {
    for (const g of GROUPS) {
      expect(GROUP_BY_SLUG.get(groupSlug(g.name))).toBe(g)
    }
  })

  it('does not include the Other fallback in the registry', () => {
    expect(GROUPS).not.toContain(OTHER_GROUP)
  })

  it('gives every group a hex colour and a short abbreviation', () => {
    for (const g of GROUPS) {
      expect(g.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(g.abbr.length).toBeGreaterThan(0)
      expect(g.abbr.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('groupForKeyword — brand matching', () => {
  it('matches a plain brand term', () => {
    expect(groupForKeyword('cleobetra casino review').name).toBe('Cleobetra')
  })

  it('is case and punctuation insensitive', () => {
    expect(groupForKeyword('CLEOBETRA  Casino!').name).toBe('Cleobetra')
  })

  it('matches a brand written with punctuation via its alias', () => {
    expect(groupForKeyword('bc game promo code').name).toBe('BC.Game')
    expect(groupForKeyword('wild io casino').name).toBe('Wild.io')
    expect(groupForKeyword('jack com review').name).toBe('Jack.com')
  })

  it('matches a numeric brand name', () => {
    expect(groupForKeyword('10bet bonus').name).toBe('10Bet')
    expect(groupForKeyword('lucky7even free spins').name).toBe('Lucky7Even')
  })
})

describe('groupForKeyword — the collision that matters', () => {
  // 'Jack.com' is a real brand on the site and 'live blackjack' is a real
  // keyword. Substring matching classifies the second as the first, which is
  // wrong and looks entirely plausible in the UI. Word-boundary matching is
  // what prevents it.
  it('does not classify "live blackjack" as Jack.com', () => {
    const g = groupForKeyword('live blackjack')
    expect(g.name).not.toBe('Jack.com')
    expect(g.name).toBe('Live Casino')
  })

  it('does not classify "best blackjack sites" as Jack.com', () => {
    expect(groupForKeyword('best blackjack sites').name).not.toBe('Jack.com')
  })

  it('still classifies a genuine Jack.com term correctly', () => {
    expect(groupForKeyword('jack.com casino review').name).toBe('Jack.com')
  })

  it('does not match a brand inside a longer unrelated word', () => {
    expect(groupForKeyword('mistaken identity casino').name).not.toBe('Stake')
    expect(groupForKeyword('realzy bonus').name).not.toBe('Realz')
  })
})

describe('groupForKeyword — precedence', () => {
  it('prefers the longest match within the same kind', () => {
    expect(groupForKeyword('best live casino uae').name).toBe('Live Casino')
  })

  it('prefers a brand over a LONGER category phrase', () => {
    // Regression: ranking purely by phrase length let the 2-token category
    // 'free spins' beat the 1-token brand 'lucky7even'. Naming a brand is the
    // more specific claim, so brand precedence must dominate length.
    expect(groupForKeyword('lucky7even free spins').name).toBe('Lucky7Even')
    expect(groupForKeyword('stake no deposit bonus').name).toBe('Stake')
    expect(groupForKeyword('rabona fast withdrawal').name).toBe('Rabona')
  })

  it('prefers a brand over a category on an equal-length match', () => {
    // 'casinia' (brand, 1 token) vs 'bonus' (category, 1 token)
    expect(groupForKeyword('casinia bonus').name).toBe('Casinia')
  })

  it('is deterministic for the same input', () => {
    const a = groupForKeyword('spinsup casino bonus')
    const b = groupForKeyword('spinsup casino bonus')
    expect(a.name).toBe(b.name)
  })
})

describe('groupForKeyword — categories', () => {
  it('matches crypto terms', () => {
    expect(groupForKeyword('best crypto casinos uae').name).toBe('Crypto Casinos')
    expect(groupForKeyword('no kyc bitcoin casino').name).toBe('Crypto Casinos')
  })

  it('matches bonus terms', () => {
    expect(groupForKeyword('no deposit bonus codes').name).toBe('Bonuses')
    expect(groupForKeyword('casino cashback offers').name).toBe('Bonuses')
  })

  it('matches slot terms', () => {
    expect(groupForKeyword('high rtp slots').name).toBe('Slots')
    expect(groupForKeyword('jackpot game guide').name).toBe('Slots')
  })

  it('matches crash and instant games', () => {
    expect(groupForKeyword('aviator game strategy').name).toBe('Crash & Instant')
    expect(groupForKeyword('plinko casino').name).toBe('Crash & Instant')
  })
})

describe('groupForKeyword — fallback', () => {
  it('returns Other for an unmatched keyword rather than dropping it', () => {
    expect(groupForKeyword('zzz unmatched phrase').name).toBe(OTHER_GROUP.name)
  })

  it('returns Other for an empty keyword', () => {
    expect(groupForKeyword('').name).toBe(OTHER_GROUP.name)
  })
})

describe('orderMarkets', () => {
  it('puts registry markets first in registry order', () => {
    expect(orderMarkets(['US', 'AE'])).toEqual(['AE', 'US'])
  })

  it('appends unlisted markets alphabetically rather than dropping them', () => {
    // Dropping an unexpected market loses data silently, which is worse than
    // showing a column nobody planned for.
    expect(orderMarkets(['ZA', 'US', 'AE', 'KW'])).toEqual(['AE', 'KW', 'US', 'ZA'])
  })

  it('deduplicates', () => {
    expect(orderMarkets(['AE', 'AE', 'US'])).toEqual(['AE', 'US'])
  })

  it('includes AE first in the registry order', () => {
    expect(MARKET_ORDER[0]).toBe('AE')
  })
})
