import type {
  RankingRecord,
  RecordMatcher,
  RecordPatch,
  Snapshot,
  SnapshotMeta,
} from '../types'
import { formatDisplayDate } from './dates'
import { supabase } from './supabase'

/** ~2 months at a weekly cadence — enough history to read movement without
 *  downloading everything on mount. */
export const DEFAULT_RECENT = 8

/** PostgREST caps a response at 1000 rows. */
export const PAGE = 1000

/** Insert batch size: few enough round trips to be fast, small enough to stay
 *  well under statement and payload limits. */
export const CHUNK = 500

const RECORD_COLS =
  'snapshot_id, keyword, market, position, previous, change, url_found, search_volume, date'

interface RecordRow {
  snapshot_id: string
  keyword: string
  market: string
  position: string
  previous: string | null
  change: string | null
  url_found: string | null
  search_volume: string | null
  date: string | null
}

// ─── Mapping ────────────────────────────────────────────────────────────────

/**
 * Re-derives displayDate from raw_date instead of trusting the stored column, so
 * rows written under an older format still render in the current one. Store the
 * derived value, but never trust it on read.
 */
export function toSnapshotMeta(row: { id: string; raw_date: string }): SnapshotMeta {
  return {
    id: row.id,
    rawDate: row.raw_date,
    displayDate: formatDisplayDate(row.raw_date),
  }
}

function toRecord(row: RecordRow): RankingRecord {
  return {
    keyword: row.keyword,
    market: row.market,
    position: row.position,
    previous: row.previous ?? '',
    change: row.change ?? '',
    urlFound: row.url_found ?? '',
    searchVolume: row.search_volume ?? '',
    date: row.date ?? '',
  }
}

function toRow(snapshotId: string, r: RankingRecord): RecordRow {
  return {
    snapshot_id: snapshotId,
    keyword: r.keyword,
    market: r.market,
    position: r.position,
    previous: r.previous,
    change: r.change,
    url_found: r.urlFound,
    search_volume: r.searchVolume,
    date: r.date,
  }
}

/**
 * Defensive dedupe on read, keyed by keyword|market. If a past upload left
 * orphan rows behind — because an FK cascade was not actually configured on the
 * deployed database — stats would otherwise read double what the matrix renders.
 */
export function dedupeRecords(records: RankingRecord[]): RankingRecord[] {
  const byKey = new Map<string, RankingRecord>()
  for (const r of records) {
    byKey.set(`${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`, r)
  }
  return Array.from(byKey.values())
}

/** Every page range needed to read `count` rows. Always at least one range, so
 *  an empty table still issues a well-formed query. */
export function pageRanges(count: number): Array<[number, number]> {
  const pages = Math.max(1, Math.ceil(count / PAGE))
  return Array.from(
    { length: pages },
    (_, i) => [i * PAGE, i * PAGE + PAGE - 1] as [number, number],
  )
}

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`)
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function loadSnapshotMeta(): Promise<SnapshotMeta[]> {
  const { data, error } = await supabase
    .from('snapshots')
    .select('id, raw_date')
    // raw_date first: a backfill writes newest-first, so created_at desc alone
    // would report the oldest snapshot as the latest.
    .order('raw_date', { ascending: false })
    .order('created_at', { ascending: false })
  fail('Could not load the snapshot list', error)
  return (data ?? []).map(toSnapshotMeta)
}

/**
 * Reads all records for the given snapshots.
 *
 * One head-count, then every page IN PARALLEL — latency is 1 + ceil(N/1000)
 * round trips, not N/1000 sequential ones. If this is ever "simplified" into a
 * single select, large datasets truncate silently at 1000 rows and every stat
 * counter reads low with no error surfacing anywhere.
 */
export async function loadSnapshotRecords(
  ids: string[],
): Promise<Map<string, RankingRecord[]>> {
  const out = new Map<string, RankingRecord[]>()
  if (ids.length === 0) return out

  const { count, error: countError } = await supabase
    .from('ranking_records')
    .select('*', { count: 'exact', head: true })
    .in('snapshot_id', ids)
  fail('Could not count ranking records', countError)

  const pages = await Promise.all(
    pageRanges(count ?? 0).map(([from, to]) =>
      supabase
        .from('ranking_records')
        .select(RECORD_COLS)
        .in('snapshot_id', ids)
        .range(from, to),
    ),
  )

  const grouped = new Map<string, RankingRecord[]>()
  for (const page of pages) {
    fail('Could not load ranking records', page.error)
    for (const row of (page.data ?? []) as unknown as RecordRow[]) {
      const list = grouped.get(row.snapshot_id) ?? []
      list.push(toRecord(row))
      grouped.set(row.snapshot_id, list)
    }
  }

  for (const [id, records] of grouped) out.set(id, dedupeRecords(records))
  return out
}

/**
 * The mount query: ALL metadata (cheap — dozens of rows) but records only for
 * the newest `recentCount` snapshots. The UI therefore knows how much history
 * exists without downloading it, and can hydrate older batches on demand.
 */
export async function loadRecentSnapshots(
  recentCount: number = DEFAULT_RECENT,
): Promise<{ meta: SnapshotMeta[]; snapshots: Snapshot[] }> {
  const meta = await loadSnapshotMeta()
  const recent = meta.slice(0, recentCount)
  const records = await loadSnapshotRecords(recent.map((m) => m.id))
  return {
    meta,
    snapshots: recent.map((m) => ({ ...m, records: records.get(m.id) ?? [] })),
  }
}

export async function loadOlderSnapshots(metaEntries: SnapshotMeta[]): Promise<Snapshot[]> {
  if (metaEntries.length === 0) return []
  const records = await loadSnapshotRecords(metaEntries.map((m) => m.id))
  return metaEntries.map((m) => ({ ...m, records: records.get(m.id) ?? [] }))
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * Wipe-and-replace, idempotent by construction.
 *
 * Child rows are deleted EXPLICITLY rather than relying on ON DELETE CASCADE. If
 * the cascade is not actually configured on the deployed database, deleting only
 * the snapshot leaves orphans and the next re-upload silently doubles the data.
 *
 * Not atomic: this is several round trips with no transaction. A failure partway
 * through can leave that date's snapshot incomplete, and the error path tells the
 * user to re-run the import — which is safe precisely because the operation is
 * idempotent. An atomic RPC is deferred until there is a reason to add one.
 */
export async function upsertSnapshot(snapshot: Snapshot): Promise<void> {
  const delRecords = await supabase
    .from('ranking_records')
    .delete()
    .eq('snapshot_id', snapshot.id)
  fail('Could not clear the existing records', delRecords.error)

  const delSnap = await supabase.from('snapshots').delete().eq('id', snapshot.id)
  fail('Could not clear the existing snapshot', delSnap.error)

  const insSnap = await supabase.from('snapshots').insert({
    id: snapshot.id,
    raw_date: snapshot.rawDate,
    display_date: snapshot.displayDate,
  })
  fail('Could not save the snapshot', insSnap.error)

  const rows = snapshot.records.map((r) => toRow(snapshot.id, r))
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ins = await supabase.from('ranking_records').insert(rows.slice(i, i + CHUNK))
    fail('Could not save the ranking records', ins.error)
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  const delRecords = await supabase.from('ranking_records').delete().eq('snapshot_id', id)
  fail('Could not delete the ranking records', delRecords.error)
  const delSnap = await supabase.from('snapshots').delete().eq('id', id)
  fail('Could not delete the snapshot', delSnap.error)
}

/**
 * Patches matching records.
 *
 * An omitted matcher field widens the predicate, so one function serves both
 * "this exact row" and "every row for this keyword". Patch keys are detected with
 * `in` so an explicit empty string CLEARS a value while an absent key leaves it
 * untouched.
 */
export async function updateRecordFields(
  snapshotId: string,
  matcher: RecordMatcher,
  patch: RecordPatch,
): Promise<void> {
  const update: Record<string, string> = {}
  if ('searchVolume' in patch) update.search_volume = patch.searchVolume ?? ''
  if (Object.keys(update).length === 0) return

  let query = supabase.from('ranking_records').update(update).eq('snapshot_id', snapshotId)
  if (matcher.keyword !== undefined) query = query.eq('keyword', matcher.keyword)
  if (matcher.market !== undefined) query = query.eq('market', matcher.market)

  const { error } = await query
  fail('Could not save the edit', error)
}
