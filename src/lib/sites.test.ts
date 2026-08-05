import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_ID, SITES, SITE_BY_ID, SITE_BY_SLUG, siteById } from './sites'

describe('site registry', () => {
  it('contains both tracked properties', () => {
    expect(SITES.map((s) => s.id).sort()).toEqual(['hazreviews', 'onlinecasinokuwait'])
  })

  // These ids are written into the database. Changing one silently orphans
  // every snapshot already stored under the old value.
  it('pins the stored ids', () => {
    expect(SITE_BY_ID.get('hazreviews')?.domain).toBe('hazreviews.com')
    expect(SITE_BY_ID.get('onlinecasinokuwait')?.domain).toBe('onlinecasinokuwait.com')
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
    expect(SITE_BY_SLUG.get('kuwait')?.id).toBe('onlinecasinokuwait')
  })

  // An unknown id must not crash a render deep in the tree.
  it('falls back to the default for an unknown id', () => {
    expect(siteById('nope').id).toBe(DEFAULT_SITE_ID)
  })
})
