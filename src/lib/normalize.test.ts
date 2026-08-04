import { describe, expect, it } from 'vitest'
import type { RankingRecord } from '../types'
import {
  avgPosition,
  computeStats,
  computeTiers,
  effectiveDelta,
  parseChange,
  parsePosition,
} from './normalize'

function rec(partial: Partial<RankingRecord>): RankingRecord {
  return {
    keyword: 'k',
    market: 'AE',
    position: '',
    previous: '',
    change: '',
    urlFound: '',
    searchVolume: '',
    date: '2026-08-04',
    ...partial,
  }
}

describe('parsePosition', () => {
  it('returns null for an empty value', () => {
    expect(parsePosition('')).toBeNull()
    expect(parsePosition('   ')).toBeNull()
  })

  it('parses a numeric position', () => {
    expect(parsePosition('4')).toBe(4)
    expect(parsePosition(' 12 ')).toBe(12)
  })

  it('maps the not-ranking vocabulary to NR', () => {
    for (const v of ['NR', 'nr', 'not ranking', 'Not in top 100', '-', '—']) {
      expect(parsePosition(v)).toBe('NR')
    }
  })

  it('treats an unparseable non-empty value as NR rather than guessing', () => {
    // Non-empty means "we looked". NR, not null, is the honest answer.
    expect(parsePosition('banana')).toBe('NR')
  })
})

describe('parseChange', () => {
  it('returns null when there is no signal', () => {
    expect(parseChange('')).toBeNull()
    expect(parseChange('  ')).toBeNull()
  })

  it('parses signed numbers', () => {
    expect(parseChange('+2')).toBe(2)
    expect(parseChange('-3')).toBe(-3)
    expect(parseChange('0')).toBe(0)
  })

  it('parses arrow-and-magnitude tokens', () => {
    expect(parseChange('▲ 10')).toBe(10)
    expect(parseChange('▼ 10')).toBe(-10)
  })

  it('parses a bare arrow as a magnitude-unknown sentinel', () => {
    expect(parseChange('▲')).toBe(1)
    expect(parseChange('▼')).toBe(-1)
  })

  it('parses the parenthesised previous-position form', () => {
    expect(parseChange('▲ (6)')).toBe(6)
    expect(parseChange('▼ (3)')).toBe(-3)
  })
})

describe('effectiveDelta', () => {
  it('passes a normal delta through', () => {
    expect(effectiveDelta('+2', 5)).toBe(2)
  })

  it('reports no movement when the parenthesised previous equals current', () => {
    // In this cell grammar the number in parens is the PREVIOUS position, not a
    // delta. If it equals the current position, nothing actually moved, and
    // painting a green arrow there would be a lie.
    expect(effectiveDelta('▲ (4)', 4)).toBe(0)
  })

  it('keeps the delta when the parenthesised previous differs', () => {
    expect(effectiveDelta('▲ (6)', 4)).toBe(6)
  })

  it('returns 0 when there is no change token', () => {
    expect(effectiveDelta('', 4)).toBe(0)
  })
})

describe('computeStats', () => {
  const records = [
    rec({ position: '1', change: '+2' }), // top3 + improved
    rec({ position: '2', change: '-1' }), // top3 + dropped
    rec({ position: '3', change: '0' }), // top3 + unchanged
    rec({ position: '15', change: '+5' }), // improved
    rec({ position: 'NR', change: '' }), // notRanking
    rec({ position: '', change: '' }), // never checked
  ]

  it('makes the movement buckets mutually exclusive and total-summing', () => {
    const s = computeStats(records)
    expect(s.improved + s.dropped + s.unchanged + s.notRanking).toBe(s.total)
  })

  it('counts top3 as an overlapping bucket, not part of the sum', () => {
    const s = computeStats(records)
    expect(s.top3).toBe(3)
    // Deliberately NOT equal to total: Top 3 overlaps the movement buckets, and
    // /how-it-works explains that to users.
    expect(s.top3 + s.improved + s.dropped + s.unchanged + s.notRanking).not.toBe(s.total)
  })

  it('classifies by the change sign so counters match the badges', () => {
    const s = computeStats(records)
    expect(s.improved).toBe(2)
    expect(s.dropped).toBe(1)
    expect(s.notRanking).toBe(2)
    expect(s.unchanged).toBe(1)
  })

  it('returns all zeros for no records', () => {
    expect(computeStats([])).toEqual({
      total: 0,
      top3: 0,
      improved: 0,
      dropped: 0,
      notRanking: 0,
      unchanged: 0,
    })
  })
})

describe('computeTiers', () => {
  it('buckets by position band', () => {
    const t = computeTiers([
      rec({ position: '1' }),
      rec({ position: '2' }),
      rec({ position: '9' }),
      rec({ position: '14' }),
      rec({ position: 'NR' }),
    ])
    expect(t).toEqual({ p1: 1, top3: 2, top10: 3, page2: 1, nr: 1 })
  })
})

describe('avgPosition', () => {
  it('averages only ranking positions', () => {
    expect(
      avgPosition([
        rec({ position: '2' }),
        rec({ position: '4' }),
        rec({ position: 'NR' }),
        rec({ position: '' }),
      ]),
    ).toBe(3)
  })

  it('returns null when nothing ranks', () => {
    expect(avgPosition([rec({ position: 'NR' })])).toBeNull()
  })
})
