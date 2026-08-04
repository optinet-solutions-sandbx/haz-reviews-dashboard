import type { KeywordGroup } from '../types'

/**
 * THE REGISTRY — the single source of truth for keyword grouping.
 *
 * HazReviews is one site, so the sibling dashboards' "brand → many domains"
 * model does not transfer: the domain column would be constant and useless as
 * an axis. Keywords are grouped instead, by the casino brand they target or the
 * content category they belong to.
 *
 * Group membership is DERIVED by groupForKeyword() and never stored on a
 * record. That is deliberate: improving this list re-groups the entire history
 * retroactively, where a stored column would freeze today's classification
 * mistakes and need a backfill migration to fix.
 *
 * Brands are seeded from the hazreviews.com toplist as of 2026-08-04.
 * Adding a group is one entry here and nothing else.
 *
 * `aliases` exist for names whose punctuation disappears under normalisation
 * ('BC.Game' → 'bc game'). NEVER add an alias that is a token appearing inside
 * an unrelated word — a bare 'jack' alias would classify 'live blackjack' as
 * Jack.com. groups.test.ts guards exactly that.
 *
 * Order matters only for ties that survive every other rule, which keeps the
 * result deterministic. Categories whose phrases are long and specific sit
 * ahead of the broader ones.
 */
export const GROUPS: KeywordGroup[] = [
  // ─── Brands ─────────────────────────────────────────────────────────────
  { name: 'BetRepublic', abbr: 'BR', color: '#2F6FED', kind: 'brand', aliases: ['bet republic'] },
  { name: 'Cleobetra', abbr: 'CB', color: '#D4A017', kind: 'brand', aliases: [] },
  { name: 'Jack.com', abbr: 'JC', color: '#E0342B', kind: 'brand', aliases: ['jack com', 'jackcom'] },
  { name: 'Rabona', abbr: 'RB', color: '#12A150', kind: 'brand', aliases: [] },
  { name: 'BetScore', abbr: 'BS', color: '#1F7AE0', kind: 'brand', aliases: ['bet score'] },
  { name: 'JawharaBet', abbr: 'JW', color: '#8E44AD', kind: 'brand', aliases: ['jawhara bet'] },
  { name: 'Kingmaker', abbr: 'KM', color: '#B8860B', kind: 'brand', aliases: ['king maker'] },
  { name: 'AlaWin', abbr: 'AW', color: '#00A3A3', kind: 'brand', aliases: ['ala win'] },
  { name: 'Sportuna', abbr: 'SP', color: '#E8590C', kind: 'brand', aliases: [] },
  { name: 'Spinational', abbr: 'SN', color: '#5B4FE0', kind: 'brand', aliases: [] },
  { name: 'AmunRa', abbr: 'AR', color: '#C79A2E', kind: 'brand', aliases: ['amun ra'] },
  { name: 'Legiano', abbr: 'LG', color: '#2E7D32', kind: 'brand', aliases: [] },
  { name: 'Malina', abbr: 'ML', color: '#D6336C', kind: 'brand', aliases: [] },
  { name: 'Tikitaka', abbr: 'TT', color: '#F76707', kind: 'brand', aliases: ['tiki taka'] },
  { name: 'Rollero', abbr: 'RL', color: '#1C7ED6', kind: 'brand', aliases: [] },
  { name: 'Millioner', abbr: 'MI', color: '#7048E8', kind: 'brand', aliases: [] },
  { name: 'Realz', abbr: 'RZ', color: '#0CA678', kind: 'brand', aliases: [] },
  { name: 'FortunePlay', abbr: 'FP', color: '#E03131', kind: 'brand', aliases: ['fortune play'] },
  { name: 'Lucky7Even', abbr: 'L7', color: '#F59F00', kind: 'brand', aliases: ['lucky 7even', 'lucky7 even', 'lucky seven'] },
  { name: 'Wyns', abbr: 'WY', color: '#3B5BDB', kind: 'brand', aliases: [] },
  { name: 'Royals', abbr: 'RY', color: '#9C36B5', kind: 'brand', aliases: [] },
  { name: '10Bet', abbr: '10', color: '#1971C2', kind: 'brand', aliases: ['10 bet'] },
  { name: 'Wild.io', abbr: 'WI', color: '#F03E3E', kind: 'brand', aliases: ['wild io', 'wildio'] },
  { name: 'Shuffle', abbr: 'SH', color: '#495057', kind: 'brand', aliases: [] },
  { name: 'JB', abbr: 'JB', color: '#0B7285', kind: 'brand', aliases: [] },
  { name: 'Casinia', abbr: 'CA', color: '#E8B84B', kind: 'brand', aliases: [] },
  { name: 'Thrill', abbr: 'TH', color: '#C2255C', kind: 'brand', aliases: [] },
  { name: 'YYY', abbr: 'YY', color: '#5C940D', kind: 'brand', aliases: [] },
  { name: 'LuckyOnes', abbr: 'LO', color: '#F08C00', kind: 'brand', aliases: ['lucky ones'] },
  { name: 'JustCasino', abbr: 'JU', color: '#1098AD', kind: 'brand', aliases: ['just casino'] },
  { name: 'PlayMojo', abbr: 'PM', color: '#7950F2', kind: 'brand', aliases: ['play mojo'] },
  { name: 'BC.Game', abbr: 'BC', color: '#22B573', kind: 'brand', aliases: ['bc game', 'bcgame'] },
  { name: 'Stake', abbr: 'ST', color: '#1A6DD6', kind: 'brand', aliases: [] },
  { name: 'Spinsup', abbr: 'SU', color: '#E64980', kind: 'brand', aliases: ['spins up'] },
  { name: 'LuckyDreams', abbr: 'LD', color: '#4C6EF5', kind: 'brand', aliases: ['lucky dreams'] },
  { name: 'NovaJackpot', abbr: 'NJ', color: '#12B886', kind: 'brand', aliases: ['nova jackpot'] },
  { name: 'Spinight', abbr: 'SG', color: '#6741D9', kind: 'brand', aliases: [] },
  { name: 'Roosterbet', abbr: 'RO', color: '#D9480F', kind: 'brand', aliases: ['rooster bet'] },

  // ─── Categories ─────────────────────────────────────────────────────────
  // Multi-word phrases win over single-word brand matches on length, which is
  // what makes 'best live casino' land on Live Casino rather than a brand.
  {
    name: 'Live Casino', abbr: 'LV', color: '#C2255C', kind: 'category',
    aliases: ['live casino', 'live dealer', 'blackjack', 'roulette', 'baccarat', 'poker'],
  },
  {
    name: 'Crypto Casinos', abbr: 'CR', color: '#F7931A', kind: 'category',
    aliases: ['crypto', 'crypto casino', 'crypto casinos', 'bitcoin', 'btc', 'ethereum', 'eth', 'usdt', 'no kyc', 'nokyc', 'anonymous'],
  },
  {
    name: 'Bonuses', abbr: 'BN', color: '#FAB005', kind: 'category',
    aliases: ['bonus', 'bonuses', 'no deposit', 'free spins', 'cashback', 'vip', 'wagering', 'promo code', 'welcome offer'],
  },
  {
    name: 'Slots', abbr: 'SL', color: '#7048E8', kind: 'category',
    aliases: ['slot', 'slots', 'rtp', 'jackpot', 'jackpots', 'bonus buy', 'megaways', 'best payout'],
  },
  {
    name: 'Crash & Instant', abbr: 'CI', color: '#0CA678', kind: 'category',
    aliases: ['aviator', 'plinko', 'dice', 'crash game', 'mines'],
  },
  {
    name: 'Payments & Payouts', abbr: 'PY', color: '#1098AD', kind: 'category',
    aliases: ['fast withdrawal', 'fast payout', 'withdrawal', 'payout', 'low deposit', 'minimum deposit', 'payment methods'],
  },
  {
    name: 'New & Trending', abbr: 'NW', color: '#4C6EF5', kind: 'category',
    aliases: ['new casino', 'new casinos', 'newest', 'best casino', 'best casinos', 'top casinos'],
  },
  {
    name: 'Guides & Trust', abbr: 'GD', color: '#495057', kind: 'category',
    aliases: ['review', 'reviews', 'guide', 'how to', 'is legit', 'legit', 'safe', 'licence', 'license', 'rigged'],
  },
]

/**
 * Fallback group. Kept OUT of GROUPS so it never appears as a real registry
 * entry, while still guaranteeing every keyword resolves to something — an
 * unmatched keyword must stay visible, not vanish.
 */
export const OTHER_GROUP: KeywordGroup = {
  name: 'Other',
  abbr: 'OT',
  color: '#8EA1BA',
  kind: 'category',
  aliases: [],
}

/**
 * Matrix column order. Unlisted markets are appended, never dropped.
 *
 * ASSUMPTION: the real market list is unconfirmed. UAE-primary is inferred
 * from the site's en-AE tag and its link to hazemirates.com. Correcting this is
 * a one-line edit once a real export arrives.
 */
export const MARKET_ORDER: string[] = ['AE']

export function groupSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const GROUP_BY_SLUG: Map<string, KeywordGroup> = new Map(
  GROUPS.map((g) => [groupSlug(g.name), g]),
)

/**
 * Lowercases, collapses every non-alphanumeric run into a single space, and
 * pads with spaces so that testing for ' token ' is a true word-boundary test.
 */
function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

function normalizePhrase(phrase: string): string {
  return phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Every phrase that means a given group: its name plus its aliases. */
function phrasesFor(group: KeywordGroup): string[] {
  return [group.name, ...group.aliases]
    .map(normalizePhrase)
    .filter((p) => p.length > 0)
}

interface Candidate {
  group: KeywordGroup
  /** Token count of the matched phrase — the longest match wins. */
  length: number
}

/**
 * Resolves a keyword to exactly one group.
 *
 * Matching is word-boundary only. Substring matching is the obvious
 * implementation and it is wrong: the brand 'Jack.com' would claim the keyword
 * 'live blackjack', which is both incorrect and entirely plausible-looking in
 * the UI. Padding both haystack and needle with spaces makes ' jack ' fail
 * against ' live blackjack ' while still matching ' jack com review '.
 *
 * Precedence, in order:
 *   1. A brand match beats ANY category match, regardless of phrase length.
 *      'lucky7even free spins' is a Lucky7Even keyword, not a Bonuses keyword —
 *      naming a brand is a more specific claim than naming a content theme, and
 *      ranking by length alone lets the 2-token 'free spins' steal it.
 *   2. Within the same kind, the longest matched phrase wins, so 'live casino'
 *      beats a bare 'casino'-adjacent term.
 *   3. Anything still tied falls to registry order, keeping results stable
 *      across runs.
 */
export function groupForKeyword(keyword: string): KeywordGroup {
  const haystack = normalizeForMatch(keyword)
  if (haystack.trim().length === 0) return OTHER_GROUP

  let best: Candidate | null = null

  for (const group of GROUPS) {
    for (const phrase of phrasesFor(group)) {
      if (!haystack.includes(` ${phrase} `)) continue

      const candidate: Candidate = { group, length: phrase.split(' ').length }
      if (best === null || beats(candidate, best)) best = candidate
    }
  }

  return best?.group ?? OTHER_GROUP
}

/** Strict "is a better match than", implementing the precedence rules above. */
function beats(candidate: Candidate, incumbent: Candidate): boolean {
  const candidateIsBrand = candidate.group.kind === 'brand'
  const incumbentIsBrand = incumbent.group.kind === 'brand'
  if (candidateIsBrand !== incumbentIsBrand) return candidateIsBrand
  return candidate.length > incumbent.length
}

/**
 * Registry markets first in registry order, then anything unexpected appended
 * alphabetically. Unknown markets are surfaced, never dropped — losing data
 * silently is worse than rendering an unplanned column.
 */
export function orderMarkets(markets: string[]): string[] {
  const unique = Array.from(new Set(markets))
  const known = MARKET_ORDER.filter((m) => unique.includes(m))
  const unknown = unique.filter((m) => !MARKET_ORDER.includes(m)).sort()
  return [...known, ...unknown]
}
