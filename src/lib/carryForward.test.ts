import { describe, expect, it } from 'vitest'
import type { RankingRecord } from '../types'
import { applyCarryForward } from './carryForward'

function rec(keyword: string, market: string, searchVolume = ''): RankingRecord {
  return {
    keyword,
    market,
    position: '1',
    previous: '',
    change: '',
    urlFound: '',
    searchVolume,
    date: '',
  }
}

function snap(rawDate: string, records: RankingRecord[]) {
  return { id: `snap-${rawDate}`, rawDate, displayDate: rawDate, records }
}

describe('applyCarryForward', () => {
  it('fills an empty searchVolume from an older snapshot', () => {
    const out = applyCarryForward([
      snap('2026-08-04', [rec('crypto casino', 'AE', '')]),
      snap('2026-07-28', [rec('crypto casino', 'AE', '2.4K')]),
    ])
    const newest = out.find((s) => s.rawDate === '2026-08-04')!
    expect(newest.records[0].searchVolume).toBe('2.4K')
  })

  it('never overwrites a value the record already has', () => {
    const out = applyCarryForward([
      snap('2026-07-28', [rec('k', 'AE', '1K')]),
      snap('2026-08-04', [rec('k', 'AE', '9K')]),
    ])
    expect(out.find((s) => s.rawDate === '2026-08-04')!.records[0].searchVolume).toBe('9K')
  })

  it('keys on keyword AND market, so markets do not bleed into each other', () => {
    const out = applyCarryForward([
      snap('2026-07-28', [rec('k', 'AE', '1K')]),
      snap('2026-08-04', [rec('k', 'US', '')]),
    ])
    expect(out.find((s) => s.rawDate === '2026-08-04')!.records[0].searchVolume).toBe('')
  })

  it('does not let a cleared upstream value keep flowing forward', () => {
    // Seeding the maps from DERIVED values would make '1K' immortal: 08-04 would
    // inherit from the already-filled 07-28 even though 07-28's RAW value is now
    // empty, and there would be no way to ever delete the number. Seeding from
    // raw values is what makes a deletion stick.
    const out = applyCarryForward([
      snap('2026-07-21', [rec('k', 'AE', '1K')]),
      snap('2026-07-28', [rec('k', 'AE', '')]),
      snap('2026-08-04', [rec('k', 'AE', '')]),
    ])
    const byDate = (d: string) => out.find((s) => s.rawDate === d)!.records[0].searchVolume
    expect(byDate('2026-07-28')).toBe('1K')
    expect(byDate('2026-08-04')).toBe('1K')
  })

  it('preserves the caller-controlled snapshot order', () => {
    const out = applyCarryForward([
      snap('2026-08-04', [rec('k', 'AE')]),
      snap('2026-07-28', [rec('k', 'AE')]),
    ])
    expect(out.map((s) => s.rawDate)).toEqual(['2026-08-04', '2026-07-28'])
  })

  it('does not mutate the input', () => {
    const input = [
      snap('2026-07-28', [rec('k', 'AE', '1K')]),
      snap('2026-08-04', [rec('k', 'AE', '')]),
    ]
    applyCarryForward(input)
    expect(input[1].records[0].searchVolume).toBe('')
  })

  it('handles an empty list', () => {
    expect(applyCarryForward([])).toEqual([])
  })
})
