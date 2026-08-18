import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SITE_ID,
  SITES,
  type Site,
  SITE_BY_ID,
  SITE_BY_SLUG,
  siteById,
  siteInitials,
  siteMonogram,
} from './sites'

describe('site registry', () => {
  // Exact, not a length or a `contains`: the five Trybet properties were removed
  // from here, and an assertion that merely checked HAZREVIEWS was present would
  // pass just as well if one of them came back.
  it('contains the tracked sites', () => {
    expect(SITES.map((s) => s.id)).toEqual(['hazreviews'])
  })

  // These ids are written into the database. Changing one silently orphans
  // every snapshot already stored under the old value.
  it('pins the stored ids', () => {
    expect(SITE_BY_ID.get('hazreviews')?.domain).toBe('hazreviews.com')
  })

  /**
   * The hazard behind that warning, asserted so it is known rather than
   * discovered. A snapshot stored under a site since removed from the registry
   * does not error — it silently resolves to the default site and its rows merge
   * into that site's figures. Removing an entry is safe only while nothing has
   * been imported under it.
   */
  it('silently resolves a de-registered id to the default site', () => {
    expect(siteById('onlinecasinokuwait').id).toBe(DEFAULT_SITE_ID)
  })

  it('has unique ids and slugs', () => {
    expect(new Set(SITES.map((s) => s.id)).size).toBe(SITES.length)
    expect(new Set(SITES.map((s) => s.slug)).size).toBe(SITES.length)
  })

  it('resolves the default site', () => {
    expect(SITE_BY_ID.get(DEFAULT_SITE_ID)).toBeDefined()
    expect(DEFAULT_SITE_ID).toBe('hazreviews')
  })

  it('looks up by slug', () => {
    expect(SITE_BY_SLUG.get('hazreviews')?.id).toBe('hazreviews')
  })

  /**
   * React Router ranks a static segment above a dynamic one, so '/sites' always
   * resolves to the site directory — never to a site whose slug happens to be
   * 'sites'. Such a site would be silently unreachable: no error, just a page
   * showing the wrong thing. Same for every other top-level route.
   */
  it('reserves the slugs already used by static routes', () => {
    const reserved = ['sites', 'log', 'how-it-works', 'admin', 'ask-ai', 'trash']
    for (const site of SITES) {
      expect(reserved).not.toContain(site.slug)
    }
  })

  // An unknown id must not crash a render deep in the tree.
  it('falls back to the default for an unknown id', () => {
    expect(siteById('nope').id).toBe(DEFAULT_SITE_ID)
  })
})

// Derived rather than stored, so adding a site stays "one entry and nothing
// else" — the registry's stated promise. Add an `abbr` field only if a specific
// site needs a monogram this cannot produce.
describe('siteInitials', () => {
  it('splits a camelCase name into initials', () => {
    expect(siteInitials('OnlineCasinoKuwait')).toBe('OCK')
  })

  it('takes the leading letters of a single all-caps word', () => {
    expect(siteInitials('HAZREVIEWS')).toBe('HAZ')
  })

  it('splits on spaces and punctuation too', () => {
    expect(siteInitials('Haz Reviews')).toBe('HR')
    expect(siteInitials('betscore-arabia')).toBe('BA')
  })

  it('caps at three characters so the tile never overflows', () => {
    expect(siteInitials('One Two Three Four Five')).toBe('OTT')
  })

  // Never returns an empty string: a blank monogram tile reads as a broken image.
  it('falls back for a name with no letters', () => {
    expect(siteInitials('')).toBe('?')
    expect(siteInitials('—')).toBe('?')
  })

  /**
   * The reason `abbr` exists, asserted from both ends: the deriver genuinely
   * cannot separate two names that agree for three words, and an entry can. Left
   * to initials alone the site directory would show two identical tiles, which
   * reads as a duplicated row rather than two properties.
   */
  it('cannot separate names that differ only past the third word', () => {
    expect(siteInitials('Haz Reviews (.ca)')).toBe(siteInitials('Haz Reviews (.com)'))
  })

  // A literal, not a registry entry: no registered site needs an `abbr` now that
  // the Trybet properties are gone, and the override must keep working for the
  // next colliding pair rather than only for the one that motivated it.
  it('prefers an explicit abbr over the derived initials', () => {
    const ca: Site = {
      id: 'x',
      name: 'Haz Reviews (.ca)',
      domain: 'hazreviews.ca',
      slug: 'x',
      color: '#000',
      abbr: 'HRA',
    }
    expect(siteMonogram(ca)).toBe('HRA')
    expect(siteMonogram(ca)).not.toBe(siteInitials(ca.name))
  })

  it('derives the monogram for an entry carrying no abbr', () => {
    const haz = SITE_BY_ID.get('hazreviews')!
    expect(haz.abbr).toBeUndefined()
    expect(siteMonogram(haz)).toBe('HAZ')
  })

  it('produces a distinct monogram for every registered site', () => {
    const all = SITES.map(siteMonogram)
    expect(new Set(all).size).toBe(SITES.length)
  })
})
