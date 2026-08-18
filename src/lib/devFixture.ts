import type { RankingRecord, Snapshot, SnapshotMeta } from '../types'
import { formatDisplayDate } from './dates'
import { isDemoBuild, type DevEnv } from './devOverrides'

/**
 * LOCAL DEVELOPMENT ONLY — stand-in snapshots so Home's cards, leaderboard,
 * movers and dialogs can be seen with real numbers while Supabase is still on
 * placeholder credentials.
 *
 * Two unlocks, exactly as in `devOverrides.ts`: `DEV` + `VITE_DEV_FORCE_FIXTURE`
 * locally, or `VITE_DEMO_MODE` for the deployed demo. Never make the dev flag
 * alone sufficient — the `DEV` guard is what stops a stray local variable from
 * conjuring fake ranking data into a real dashboard.
 *
 * Note what that guard does NOT do. It makes this data inert in a normal
 * production build; it does not remove it. `resolveDevFixture` reads `DEV` off a
 * parameter, so Rollup cannot prove the early return, and the rows below ship in
 * every bundle — grep `dist/` for 'example.com' and they are there. Acceptable
 * at a few kB, and it is why demo mode costs no bundle size, but do not restate
 * the old claim that the bundler drops them.
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
  if (!isDemoBuild(env)) {
    if (!env.DEV) return null
    if (env.VITE_DEV_FORCE_FIXTURE !== 'true') return null
  }
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

/** Resolved once at module load; `null` unless a dev flag or demo mode says so. */
export const DEV_FIXTURE = resolveDevFixture(import.meta.env)
