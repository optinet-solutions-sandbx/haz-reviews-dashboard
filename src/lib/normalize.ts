import type { ParsedPosition, RankingRecord, StatsCounts, TierCounts } from '../types'

const NOT_RANKING = new Set(['nr', 'not ranking', 'not in top 100', '-', '—', '--'])

const UP_ARROWS = ['▲', '↑']

/**
 * Normalises a raw position cell.
 *
 * Downstream code must compare against 'NR', never against the original source
 * strings — the vocabulary varies between exports and new spellings appear
 * without warning.
 */
export function parsePosition(pos: string): ParsedPosition {
  const raw = (pos ?? '').trim()
  if (raw === '') return null
  if (NOT_RANKING.has(raw.toLowerCase())) return 'NR'
  const n = parseInt(raw, 10)
  // An unparseable but non-empty value means "we looked and it wasn't there",
  // which is NR — not null, which means "we never looked".
  return Number.isFinite(n) ? n : 'NR'
}

/**
 * Parses a movement token: signed numbers, arrow-plus-magnitude, bare arrows
 * (magnitude unknown, so ±1 as a sentinel), and the parenthesised
 * previous-position form.
 */
export function parseChange(chg: string): number | null {
  const raw = (chg ?? '').trim()
  if (raw === '') return null

  const parens = /^([▲▼↑↓])\s*\(\s*(\d+)\s*\)$/.exec(raw)
  if (parens) {
    const n = parseInt(parens[2], 10)
    return UP_ARROWS.includes(parens[1]) ? n : -n
  }

  const arrowNum = /^([▲▼↑↓])\s*(\d+)$/.exec(raw)
  if (arrowNum) {
    const n = parseInt(arrowNum[2], 10)
    return UP_ARROWS.includes(arrowNum[1]) ? n : -n
  }

  if (/^[▲↑]$/.test(raw)) return 1
  if (/^[▼↓]$/.test(raw)) return -1

  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * The delta that actually happened.
 *
 * In the parenthesised grammar the number is the PREVIOUS position, not a delta.
 * If it equals the current position then nothing moved, and reporting a jump
 * there would paint a green arrow on a static ranking.
 */
export function effectiveDelta(change: string, currentPos: ParsedPosition): number {
  const d = parseChange(change) ?? 0
  if (d !== 0 && typeof currentPos === 'number') {
    const m = /^[▲▼↑↓]\s*\(\s*(\d+)\s*\)$/.exec((change ?? '').trim())
    if (m && parseInt(m[1], 10) === currentPos) return 0
  }
  return d
}

/**
 * Two layers of counting.
 *
 * Movement buckets are mutually exclusive and sum to `total`. `top3` OVERLAPS
 * them on purpose: a top-3 keyword that moved up should read green AND count in
 * Top 3. The five stat cards therefore do not sum to total — that is a product
 * decision, not a bug, and /how-it-works explains it to users.
 *
 * Movement is driven by the change sign so the counters track precisely what
 * PosBadge paints.
 */
export function computeStats(records: RankingRecord[]): StatsCounts {
  const s: StatsCounts = {
    total: 0,
    top3: 0,
    improved: 0,
    dropped: 0,
    notRanking: 0,
    unchanged: 0,
  }

  for (const r of records) {
    s.total += 1
    const pos = parsePosition(r.position)

    if (pos === 'NR' || pos === null) {
      s.notRanking += 1
      continue
    }

    const d = effectiveDelta(r.change, pos)
    if (d > 0) s.improved += 1
    else if (d < 0) s.dropped += 1
    else s.unchanged += 1

    if (pos >= 1 && pos <= 3) s.top3 += 1
  }

  return s
}

/** Position-band distribution. `top3` and `top10` are cumulative bands, so they
 *  include everything better than their ceiling. */
export function computeTiers(records: RankingRecord[]): TierCounts {
  const t: TierCounts = { p1: 0, top3: 0, top10: 0, page2: 0, nr: 0 }
  for (const r of records) {
    const pos = parsePosition(r.position)
    if (typeof pos !== 'number') {
      t.nr += 1
      continue
    }
    if (pos === 1) t.p1 += 1
    if (pos <= 3) t.top3 += 1
    if (pos <= 10) t.top10 += 1
    else if (pos <= 20) t.page2 += 1
  }
  return t
}

/** Mean of the positions that actually rank. NR and never-checked rows are
 *  excluded — including them as some large number would invent data. */
export function avgPosition(records: RankingRecord[]): number | null {
  const ranking = records
    .map((r) => parsePosition(r.position))
    .filter((p): p is number => typeof p === 'number')
  if (ranking.length === 0) return null
  return ranking.reduce((a, b) => a + b, 0) / ranking.length
}
