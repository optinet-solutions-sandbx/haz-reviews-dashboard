import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { parseRows, parseSheet, snapshotIdFor, withSnapshotDate } from './parser'

const HEADER = [
  'Keyword',
  'Country',
  'Position',
  'Previous',
  'Change',
  'URL',
  'Search Volume',
  'Date',
]

describe('snapshotIdFor', () => {
  it('is deterministic so a re-upload replaces rather than duplicates', () => {
    expect(snapshotIdFor('2026-08-04')).toBe('snap-2026-08-04')
  })
})

describe('parseRows', () => {
  it('parses a simple sheet', () => {
    const r = parseRows([
      HEADER,
      [
        'crypto casino uae',
        'AE',
        '4',
        '6',
        '+2',
        'https://hazreviews.com/crypto',
        '2.4K',
        '2026-08-04',
      ],
    ])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.snapshot.records[0]).toMatchObject({
      keyword: 'crypto casino uae',
      market: 'AE',
      position: '4',
      previous: '6',
      change: '+2',
      searchVolume: '2.4K',
      urlFound: 'https://hazreviews.com/crypto',
    })
    expect(r.snapshot.rawDate).toBe('2026-08-04')
    expect(r.snapshot.id).toBe('snap-2026-08-04')
    expect(r.snapshot.displayDate).toBe('4 Aug 26')
  })

  it('finds the header row when it is not the first row', () => {
    const r = parseRows([
      ['Export generated 4 Aug'],
      [],
      HEADER,
      ['stake casino', 'AE', '2', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
  })

  it('resolves columns by prefix as well as exact match', () => {
    const r = parseRows([
      ['keyword', 'market', 'rank', 'last check'],
      ['plinko casino', 'AE', '7', '2026-08-04'],
    ])
    expect(r.snapshot.records[0].position).toBe('7')
    expect(r.snapshot.records[0].market).toBe('AE')
  })

  it('skips and counts rows with no keyword', () => {
    const r = parseRows([
      HEADER,
      ['', 'AE', '4', '', '', '', '', '2026-08-04'],
      ['real keyword', 'AE', '5', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.skippedRows).toBe(1)
  })

  it('dedupes on keyword+market with the last occurrence winning', () => {
    const r = parseRows([
      HEADER,
      ['dup', 'AE', '9', '', '', '', '', '2026-08-04'],
      ['dup', 'AE', '3', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.snapshot.records[0].position).toBe('3')
  })

  it('keeps the same keyword in different markets', () => {
    const r = parseRows([
      HEADER,
      ['k', 'AE', '9', '', '', '', '', '2026-08-04'],
      ['k', 'US', '3', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(2)
  })

  it('uses the modal date when the column disagrees with itself', () => {
    // A stray row with a bad date must not rename the whole snapshot.
    const r = parseRows([
      HEADER,
      ['a', 'AE', '1', '', '', '', '', '2026-08-04'],
      ['b', 'AE', '1', '', '', '', '', '2026-08-04'],
      ['c', 'AE', '1', '', '', '', '', '2026-07-28'],
    ])
    expect(r.snapshot.rawDate).toBe('2026-08-04')
  })

  it('reports unmatched keywords instead of dropping them', () => {
    const r = parseRows([HEADER, ['zzz nothing matches this', 'AE', '4', '', '', '', '', '2026-08-04']])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.unmatchedKeywords).toContain('zzz nothing matches this')
  })

  it('reports markets outside MARKET_ORDER instead of dropping them', () => {
    const r = parseRows([HEADER, ['stake casino', 'ZA', '4', '', '', '', '', '2026-08-04']])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.unknownMarkets).toContain('ZA')
  })

  it('defaults the market when the sheet has no country column', () => {
    const r = parseRows([
      ['keyword', 'position'],
      ['stake casino', '4'],
    ])
    expect(r.snapshot.records[0].market).toBe('AE')
  })

  it('falls back to today when no row carries a usable date', () => {
    const r = parseRows([
      ['keyword', 'position'],
      ['stake casino', '4'],
    ])
    expect(r.snapshot.rawDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('throws a readable error when there is no keyword column', () => {
    expect(() =>
      parseRows([
        ['foo', 'bar'],
        ['1', '2'],
      ]),
    ).toThrow(/keyword column/i)
  })

  it('throws a readable error when the sheet has no data rows', () => {
    expect(() => parseRows([HEADER])).toThrow(/no data rows/i)
  })
})

describe('parseSheet', () => {
  /** Builds a real workbook buffer so the XLSX integration itself is covered,
   *  not just the pure row logic underneath it. */
  function workbook(rows: unknown[][], bookType: XLSX.BookType = 'xlsx'): ArrayBuffer {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1')
    const out = XLSX.write(wb, { type: 'array', bookType })
    return out as ArrayBuffer
  }

  it('reads an xlsx workbook', () => {
    const r = parseSheet(
      workbook([HEADER, ['stake casino review', 'AE', '3', '5', '+2', '', '1.2K', '2026-08-04']]),
    )
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.snapshot.records[0].keyword).toBe('stake casino review')
    expect(r.snapshot.rawDate).toBe('2026-08-04')
  })

  it('reads a csv file', () => {
    const r = parseSheet(
      workbook([HEADER, ['plinko casino', 'AE', '7', '', '', '', '', '2026-08-04']], 'csv'),
    )
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.snapshot.records[0].position).toBe('7')
  })

  it('surfaces a readable error for a file with no usable header', () => {
    expect(() => parseSheet(workbook([['nothing', 'useful'], ['1', '2']]))).toThrow(
      /keyword column/i,
    )
  })
})

describe('withSnapshotDate', () => {
  it('re-stamps the id along with the date', () => {
    // The id must change with the date, or an overridden snapshot would
    // overwrite a different day's data.
    const parsed = parseRows([HEADER, ['k', 'AE', '1', '', '', '', '', '2026-08-04']])
    const moved = withSnapshotDate(parsed, '2026-07-28')
    expect(moved.snapshot.id).toBe('snap-2026-07-28')
    expect(moved.snapshot.rawDate).toBe('2026-07-28')
    expect(moved.snapshot.displayDate).toBe('28 Jul 26')
    expect(moved.detectedDate).toBe('2026-07-28')
    expect(moved.snapshot.records).toHaveLength(1)
  })
})
