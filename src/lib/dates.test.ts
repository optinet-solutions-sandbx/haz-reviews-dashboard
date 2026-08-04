import { describe, expect, it } from 'vitest'
import { formatDisplayDate, normalizeDateValue, toIsoLocal } from './dates'

describe('toIsoLocal', () => {
  it('uses local calendar fields, not UTC', () => {
    // Local midnight. toISOString().slice(0,10) reports the PREVIOUS day in any
    // positive-UTC zone, silently shifting every snapshot by one.
    const d = new Date(2026, 7, 4, 0, 0, 0)
    expect(toIsoLocal(d)).toBe('2026-08-04')
  })

  it('zero-pads month and day', () => {
    expect(toIsoLocal(new Date(2026, 0, 9))).toBe('2026-01-09')
  })
})

describe('formatDisplayDate', () => {
  it('formats a YYYY-MM-DD literal without a timezone shift', () => {
    // new Date('2026-08-04') is parsed as UTC and renders as 3 Aug in every
    // negative-UTC zone. Constructing from parts keeps it local.
    expect(formatDisplayDate('2026-08-04')).toBe('4 Aug 26')
  })

  it('returns the input unchanged when it is not a date literal', () => {
    expect(formatDisplayDate('whenever')).toBe('whenever')
  })
})

describe('normalizeDateValue', () => {
  it('trusts a YYYY-MM-DD literal as-is', () => {
    expect(normalizeDateValue('2026-08-04')).toBe('2026-08-04')
  })

  it('converts an Excel serial number', () => {
    expect(normalizeDateValue(46238)).toBe('2026-08-04')
  })

  it('parses a slash-formatted date as month-first', () => {
    expect(normalizeDateValue('08/04/2026')).toBe('2026-08-04')
  })

  it('accepts a Date instance', () => {
    expect(normalizeDateValue(new Date(2026, 7, 4))).toBe('2026-08-04')
  })

  it('returns empty string for junk rather than a wrong date', () => {
    // A wrong date corrupts every movement calculation downstream, so
    // no-answer beats a guess.
    expect(normalizeDateValue('n/a')).toBe('')
    expect(normalizeDateValue(null)).toBe('')
    expect(normalizeDateValue(undefined)).toBe('')
    expect(normalizeDateValue('')).toBe('')
  })
})
