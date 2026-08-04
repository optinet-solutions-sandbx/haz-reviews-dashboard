import type { ParseResult, RankingRecord } from '../types'
import { formatDisplayDate, normalizeDateValue, toIsoLocal } from './dates'
import { MARKET_ORDER, OTHER_GROUP, groupForKeyword } from './groups'

const HEADER_SCAN_ROWS = 5

/**
 * Column aliases, most specific first. Resolution is exact-then-prefix, so
 * 'position' still matches a header of 'Position (Google)'.
 */
const COLUMNS = {
  keyword: ['keyword', 'query', 'search term'],
  market: ['country', 'market', 'location', 'region'],
  position: ['position', 'rank', 'current position'],
  previous: ['previous', 'prev'],
  change: ['change', 'delta', 'movement'],
  url: ['url found', 'url', 'landing page', 'page'],
  volume: ['search volume', 'volume', 'sv'],
  date: ['last check', 'checked at', 'checked', 'date'],
} as const

type ColumnKey = keyof typeof COLUMNS

export function snapshotIdFor(rawDate: string): string {
  return `snap-${rawDate}`
}

function cell(row: unknown[], index: number): string {
  if (index < 0) return ''
  const v = row[index]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function normalizeHeader(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/**
 * Finds the header row by looking for a keyword column in the first few rows —
 * exports routinely prepend a title line or a blank row.
 */
function findHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length)
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map(normalizeHeader)
    if (cells.some((c) => COLUMNS.keyword.some((a) => c === a || c.startsWith(a)))) {
      return i
    }
  }
  return -1
}

function resolveColumns(header: unknown[]): Record<ColumnKey, number> {
  const cells = header.map(normalizeHeader)
  const out = {} as Record<ColumnKey, number>

  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    let found = -1

    // Exact match first, across every alias, before falling back to prefixes.
    // Doing prefixes per-alias would let 'date' claim a 'date added' column
    // ahead of an exact 'last check' match elsewhere in the row.
    for (const alias of COLUMNS[key]) {
      found = cells.findIndex((c) => c === alias)
      if (found >= 0) break
    }
    if (found < 0) {
      for (const alias of COLUMNS[key]) {
        found = cells.findIndex((c) => c.startsWith(alias))
        if (found >= 0) break
      }
    }

    out[key] = found
  }

  return out
}

/**
 * The most frequent non-empty value. Used for the snapshot date so that a
 * single row with a bad date cannot rename the whole snapshot.
 */
function modal(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) {
    if (v === '') continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

/**
 * The pure core of the importer: rows in, ParseResult out.
 *
 * Split from parseSheet so it is testable without building a workbook, which is
 * where every interesting edge case lives.
 */
export function parseRows(rows: unknown[][]): ParseResult {
  const headerIndex = findHeaderRow(rows)
  if (headerIndex < 0) {
    throw new Error(
      'Could not find a keyword column. Expected a header row containing "Keyword" within the first 5 rows.',
    )
  }

  const cols = resolveColumns(rows[headerIndex] ?? [])
  const dataRows = rows.slice(headerIndex + 1).filter((r) => (r ?? []).length > 0)
  if (dataRows.length === 0) {
    throw new Error('The sheet has no data rows below the header.')
  }

  // Keyed dedupe with last-write-wins, matching how exports append corrections
  // below the original row.
  const byKey = new Map<string, RankingRecord>()
  const dateValues: string[] = []
  let skippedRows = 0

  for (const row of dataRows) {
    const keyword = cell(row, cols.keyword)
    if (keyword === '') {
      skippedRows += 1
      continue
    }

    const market = cell(row, cols.market) || MARKET_ORDER[0]
    const date = normalizeDateValue(cols.date >= 0 ? row[cols.date] : '')
    if (date !== '') dateValues.push(date)

    byKey.set(`${keyword.toLowerCase()}|${market.toLowerCase()}`, {
      keyword,
      market,
      position: cell(row, cols.position),
      previous: cell(row, cols.previous),
      change: cell(row, cols.change),
      urlFound: cell(row, cols.url),
      searchVolume: cell(row, cols.volume),
      date,
    })
  }

  const records = Array.from(byKey.values())

  // Fall back to today only when the export carried no usable date at all. The
  // upload modal lets the user override this before anything is committed.
  const detectedDate = modal(dateValues) || toIsoLocal(new Date())

  const markets = Array.from(new Set(records.map((r) => r.market)))

  // Unmatched keywords and unlisted markets are REPORTED, never dropped.
  // Silently discarding rows is the failure mode that makes every counter read
  // low with no error surfacing anywhere.
  const unmatchedKeywords = records
    .filter((r) => groupForKeyword(r.keyword).name === OTHER_GROUP.name)
    .map((r) => r.keyword)
  const unknownMarkets = markets.filter((m) => !MARKET_ORDER.includes(m))

  return {
    snapshot: {
      id: snapshotIdFor(detectedDate),
      rawDate: detectedDate,
      displayDate: formatDisplayDate(detectedDate),
      records,
    },
    skippedRows,
    unmatchedKeywords,
    markets,
    unknownMarkets,
    detectedDate,
  }
}

/**
 * Re-stamps a parsed snapshot with a user-chosen date.
 *
 * The id must change with the date, or an overridden snapshot would overwrite a
 * different day's data on upsert.
 */
export function withSnapshotDate(result: ParseResult, rawDate: string): ParseResult {
  return {
    ...result,
    detectedDate: rawDate,
    snapshot: {
      ...result.snapshot,
      id: snapshotIdFor(rawDate),
      rawDate,
      displayDate: formatDisplayDate(rawDate),
    },
  }
}
