import type { RankingRecord, Snapshot, SnapshotMeta } from '../types'
import { formatDisplayDate } from './dates'
import type { DevEnv } from './devOverrides'

/**
 * LOCAL DEVELOPMENT ONLY — stand-in snapshots so Home's cards, leaderboard,
 * movers and dialogs can be seen with real numbers while Supabase is still on
 * placeholder credentials.
 *
 * Guarded exactly like `devOverrides.ts`: `import.meta.env.DEV` is statically
 * false in a production build, so this branch and its data are dropped by the
 * bundler. Never make the flag alone sufficient.
 *
 * The keywords are real brands from the group registry, so `groupForKeyword`
 * resolves them and the grouped views populate too. Positions are chosen to
 * exercise every tier AND both mover directions — a fixture that only climbed
 * would leave the Droppers branch unrendered and unverified.
 */

/** Two weeks apart, so movement is computable. Local dates, never parsed. */
const THIS_WEEK = '2026-08-13'
const LAST_WEEK = '2026-08-06'

function rows(pairs: Array<[string, string]>, market = 'AE'): RankingRecord[] {
  return pairs.map(([keyword, position]) => ({
    keyword,
    market,
    position,
    previous: '',
    change: '',
    urlFound: `https://example.com/${keyword.replace(/\s+/g, '-')}`,
    searchVolume: '',
    date: '',
  }))
}

const HAZ_THIS = rows([
  ['rabona', '1'],
  ['rabona casino', '3'],
  ['cleobetra', '2'],
  ['jack.com bonus', '7'],
  ['betrepublic', '9'],
  ['kingmaker slots', '4'],
  ['amunra', '12'],
  ['legiano review', '18'],
  ['sportuna', 'NR'],
  ['malina casino', '26'],
])
const HAZ_LAST = rows([
  ['rabona', '2'],
  ['rabona casino', '3'],
  ['cleobetra', '8'],
  ['jack.com bonus', '5'],
  ['betrepublic', '9'],
  ['kingmaker slots', '11'],
  ['amunra', '10'],
  ['legiano review', '18'],
  ['sportuna', 'NR'],
  ['malina casino', '22'],
])


/**
 * One row set per property, keyed by the id the registry stores.
 *
 * Explicit rather than mapped over SITES: devFixture.test.ts compares these ids
 * against the registry, and a fixture derived FROM the registry could never fail
 * that comparison — a newly added property would ship with no stand-in data and
 * the test would still pass, which is the opposite of what it is for.
 *
 * Each set carries a climber and a dropper of its own, so the movers panel is
 * populated whichever property is in view rather than only in the portfolio
 * roll-up. Add a property to the registry and devFixture.test.ts fails until a
 * row set joins it here — that failure is the feature.
 */
const SITE_ROWS: Array<[string, RankingRecord[], RankingRecord[]]> = [
  ['hazreviews', HAZ_THIS, HAZ_LAST],
]

function snapshot(site: string, rawDate: string, records: RankingRecord[]): Snapshot {
  return {
    // Same deterministic shape as the real upsert path.
    id: `snap-${site}-${rawDate}`,
    site,
    rawDate,
    // Re-derived, never stored — the same rule the storage layer follows on read.
    displayDate: formatDisplayDate(rawDate),
    records,
  }
}

/**
 * Newest first, matching the order Layout guarantees everywhere else.
 *
 * Grouped by DATE, not by site. With one property registered the two orders
 * coincide, so this is currently indistinguishable — which is exactly why it is
 * written the durable way round. Site-major, a second property's older snapshot
 * lands above the first property's newer one, and anything reading
 * `snapshots[0]` as "the latest" quietly gets a week-old row.
 */
const SNAPSHOTS: Snapshot[] = [
  ...SITE_ROWS.map(([site, thisWeek]) => snapshot(site, THIS_WEEK, thisWeek)),
  ...SITE_ROWS.map(([site, , lastWeek]) => snapshot(site, LAST_WEEK, lastWeek)),
]

export interface DevFixture {
  snapshots: Snapshot[]
  meta: SnapshotMeta[]
}

export function resolveDevFixture(env: DevEnv & { VITE_DEV_FORCE_FIXTURE?: string }): DevFixture | null {
  if (!env.DEV) return null
  if (env.VITE_DEV_FORCE_FIXTURE !== 'true') return null
  return {
    snapshots: SNAPSHOTS,
    meta: SNAPSHOTS.map(({ id, site, rawDate, displayDate }) => ({
      id,
      site,
      rawDate,
      displayDate,
    })),
  }
}

/** Resolved once at module load; `null` in every production build. */
export const DEV_FIXTURE = resolveDevFixture(import.meta.env)
