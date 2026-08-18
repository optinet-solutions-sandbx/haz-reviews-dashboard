import type { Snapshot } from '../types'
import { computeTiers, parsePosition } from './normalize'
import { SITES, siteById, type Site } from './sites'

/**
 * Cross-property derivations for the Home page.
 *
 * Everything here is PURE and takes the unfiltered snapshot list. That is the
 * one thing separating this file from the rest of the app: every other page
 * reads `ctx.snapshots`, already narrowed to one property. Home is deliberately
 * portfolio-wide, so it needs the whole set — see `allSnapshots` on the context.
 *
 * All of it reads only each property's NEWEST snapshot for current state, and
 * its second-newest for movement. Folding older weeks in would multiply counts
 * by however many imports exist.
 */

export interface SiteRow {
  site: Site
  /** Cumulative, matching computeTiers: p1 ⊆ top3 ⊆ top10. */
  p1: number
  top3: number
  top10: number
  keywords: number
  /** Places gained since the previous snapshot; null when there is no previous. */
  rankDelta: number | null
}

export interface PortfolioTotals {
  p1: number
  top3: number
  top10: number
  keywords: number
}

export interface PortfolioMover {
  site: Site
  keyword: string
  market: string
  from: number
  to: number
  /** Always a positive magnitude. The list it lands in carries the direction. */
  delta: number
}

/**
 * TEST SEAM. Production always passes the real registry (the default), but the
 * cross-site logic here — ranking, totals, mover attribution — cannot be
 * exercised by a registry holding a single site. Tests inject a two-site one so
 * that coverage survives however many sites happen to be configured.
 *
 * Falls through to `siteById`, which never throws: an id no longer in the
 * registry resolves to the default site rather than crashing a render.
 */
function resolve(registry: Site[], id: string): Site {
  return registry.find((s) => s.id === id) ?? siteById(id)
}

/** Snapshots for one property, newest first. */
function bySite(all: Snapshot[]): Map<string, Snapshot[]> {
  const map = new Map<string, Snapshot[]>()
  for (const s of all) {
    const list = map.get(s.site) ?? []
    list.push(s)
    map.set(s.site, list)
  }
  for (const list of map.values()) list.sort((a, b) => b.rawDate.localeCompare(a.rawDate))
  return map
}

/**
 * The newest raw date anywhere in the portfolio. Sorted explicitly rather than
 * trusting arrival order, so one property's stale import cannot present itself
 * as the latest week.
 */
export function latestWeek(all: Snapshot[]): string | null {
  let latest: string | null = null
  for (const s of all) if (!latest || s.rawDate > latest) latest = s.rawDate
  return latest
}

/** Distinct keywords in each property's newest snapshot, summed. */
export function portfolioKeywords(all: Snapshot[]): number {
  let total = 0
  for (const list of bySite(all).values()) {
    // A keyword tracked in two markets is one keyword, not two.
    total += new Set(list[0].records.map((r) => r.keyword)).size
  }
  return total
}

/** Rank order by Top-10 count, best first. Shared by the current and prior pass. */
function rankByTop10(snapshots: Array<{ site: string; snapshot: Snapshot }>): string[] {
  return snapshots
    .map(({ site, snapshot }) => ({ site, top10: computeTiers(snapshot.records).top10 }))
    .sort((a, b) => b.top10 - a.top10)
    .map((r) => r.site)
}

export function computeSiteLeaderboard(
  all: Snapshot[],
  registry: Site[] = SITES,
): { rows: SiteRow[]; totals: PortfolioTotals } {
  const grouped = bySite(all)

  const current = [...grouped.entries()].map(([site, list]) => ({ site, snapshot: list[0] }))
  const order = rankByTop10(current)

  // Previous standings, computed only from properties that actually have a
  // second snapshot. A property with one import has no rank to have moved from.
  const priorEntries = [...grouped.entries()].filter(([, list]) => list.length > 1)
  const priorOrder =
    priorEntries.length === grouped.size && grouped.size > 0
      ? rankByTop10(priorEntries.map(([site, list]) => ({ site, snapshot: list[1] })))
      : null

  const rows: SiteRow[] = order.map((siteId) => {
    const snapshot = grouped.get(siteId)![0]
    const tiers = computeTiers(snapshot.records)
    const was = priorOrder?.indexOf(siteId) ?? -1
    return {
      site: resolve(registry, siteId),
      p1: tiers.p1,
      top3: tiers.top3,
      top10: tiers.top10,
      keywords: new Set(snapshot.records.map((r) => r.keyword)).size,
      // Positive means climbed. Index 0 is the top, so a smaller index is better.
      rankDelta: priorOrder && was !== -1 ? was - order.indexOf(siteId) : null,
    }
  })

  // Summed from the per-property rows, never recomputed from a merged record
  // list — two properties tracking the same keyword are two tracked keywords.
  const totals = rows.reduce<PortfolioTotals>(
    (acc, r) => ({
      p1: acc.p1 + r.p1,
      top3: acc.top3 + r.top3,
      top10: acc.top10 + r.top10,
      keywords: acc.keywords + r.keywords,
    }),
    { p1: 0, top3: 0, top10: 0, keywords: 0 },
  )

  return { rows, totals }
}

/**
 * Movement by cross-snapshot comparison rather than the export's change column,
 * so a keyword the spreadsheet mislabelled still reports the truth.
 */
export function computePortfolioMovers(
  all: Snapshot[],
  limit = 6,
  registry: Site[] = SITES,
): { up: PortfolioMover[]; down: PortfolioMover[] } {
  const moves: PortfolioMover[] = []

  for (const [siteId, list] of bySite(all)) {
    const [active, previous] = list
    if (!previous) continue

    const prevByKey = new Map<string, number>()
    for (const r of previous.records) {
      const pos = parsePosition(r.position)
      if (typeof pos === 'number') {
        prevByKey.set(`${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`, pos)
      }
    }

    for (const r of active.records) {
      const pos = parsePosition(r.position)
      // Compare against 'NR' after parsePosition, never against the raw string.
      if (typeof pos !== 'number') continue
      const from = prevByKey.get(`${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`)
      if (from === undefined || from === pos) continue
      moves.push({
        site: resolve(registry, siteId),
        keyword: r.keyword,
        market: r.market,
        from,
        to: pos,
        delta: Math.abs(from - pos),
      })
    }
  }

  // Lower is better, so from > to is an improvement.
  const byDelta = (a: PortfolioMover, b: PortfolioMover) => b.delta - a.delta
  return {
    up: moves.filter((m) => m.from > m.to).sort(byDelta).slice(0, limit),
    down: moves.filter((m) => m.from < m.to).sort(byDelta).slice(0, limit),
  }
}
