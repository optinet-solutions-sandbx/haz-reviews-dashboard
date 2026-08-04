import type { RankingRecord } from '../types'

function recordKey(r: RankingRecord): string {
  return `${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`
}

/**
 * Fills empty `searchVolume` values forward from older snapshots.
 *
 * Two rules make this correct, and both are easy to break:
 *
 * 1. The map is seeded from RAW values, never from values this function just
 *    filled in. Otherwise clearing a volume upstream would keep the old number
 *    flowing forward forever, with no way to delete it.
 * 2. The result is DERIVED, never persisted. Applying this to stored state would
 *    freeze inheritance: downstream records would hold inherited (non-empty)
 *    values, so the fill-only-if-empty rule would skip them and later edits
 *    would stop propagating.
 */
export function applyCarryForward<T extends { rawDate: string; records: RankingRecord[] }>(
  snapshots: T[],
): T[] {
  if (snapshots.length === 0) return []

  // Oldest → newest for the walk, without disturbing the caller's order.
  const ascending = [...snapshots].sort((a, b) => a.rawDate.localeCompare(b.rawDate))

  const volumes = new Map<string, string>()
  const filledByIndex = new Map<T, RankingRecord[]>()

  for (const snapshot of ascending) {
    const records = snapshot.records.map((r) => {
      const k = recordKey(r)

      // Seed from the record's OWN value first, so a cleared value stops
      // propagating rather than being overwritten by its own inheritance.
      if (r.searchVolume.trim() !== '') {
        volumes.set(k, r.searchVolume)
        return r
      }

      const inherited = volumes.get(k)
      return inherited ? { ...r, searchVolume: inherited } : r
    })

    // Keyed by object identity: T is only constrained to { rawDate, records },
    // so there is no id field to rely on and two snapshots could share a date.
    filledByIndex.set(snapshot, records)
  }

  return snapshots.map((s) => ({ ...s, records: filledByIndex.get(s) ?? s.records }))
}
