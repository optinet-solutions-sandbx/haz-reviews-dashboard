import { describe, expect, it } from 'vitest'
import type { RankingRecord } from '../types'
import { PAGE, dedupeRecords, pageRanges, toSnapshotMeta } from './storage'

function rec(partial: Partial<RankingRecord>): RankingRecord {
  return {
    keyword: 'k',
    market: 'AE',
    position: '',
    previous: '',
    change: '',
    urlFound: '',
    searchVolume: '',
    date: '',
    ...partial,
  }
}

describe('pageRanges', () => {
  it('returns one range for an empty table', () => {
    expect(pageRanges(0)).toEqual([[0, PAGE - 1]])
  })

  it('returns one range when everything fits in a page', () => {
    expect(pageRanges(500)).toEqual([[0, PAGE - 1]])
  })

  it('covers every row above the PostgREST cap', () => {
    // PostgREST caps a response at 1000 rows and does NOT error on truncation.
    // Losing this makes every counter read low with no visible failure at all.
    const ranges = pageRanges(2500)
    expect(ranges).toHaveLength(3)
    expect(ranges[0]).toEqual([0, 999])
    expect(ranges[1]).toEqual([1000, 1999])
    expect(ranges[2]).toEqual([2000, 2999])
  })

  it('does not add an empty trailing page on an exact multiple', () => {
    expect(pageRanges(2000)).toHaveLength(2)
  })
})

describe('toSnapshotMeta', () => {
  it('re-derives displayDate rather than trusting the stored column', () => {
    const meta = toSnapshotMeta({ id: 'snap-2026-08-04', raw_date: '2026-08-04' })
    expect(meta).toEqual({
      id: 'snap-2026-08-04',
      rawDate: '2026-08-04',
      displayDate: '4 Aug 26',
    })
  })
})

describe('dedupeRecords', () => {
  it('collapses duplicate keyword+market rows, last winning', () => {
    // Orphan rows left by a past upload would otherwise make stats read double
    // what the matrix renders.
    const out = dedupeRecords([
      rec({ keyword: 'k', market: 'AE', position: '4' }),
      rec({ keyword: 'K', market: 'ae', position: '2' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].position).toBe('2')
  })

  it('keeps distinct keyword+market pairs', () => {
    const out = dedupeRecords([
      rec({ keyword: 'a', market: 'AE' }),
      rec({ keyword: 'a', market: 'US' }),
      rec({ keyword: 'b', market: 'AE' }),
    ])
    expect(out).toHaveLength(3)
  })
})
