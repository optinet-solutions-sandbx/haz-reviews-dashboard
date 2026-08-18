import { describe, expect, it } from 'vitest'
import { NAV_PAGES, hrefFor, isActive, isSiteScopedPath, pagesIn, switchSiteHref } from './nav'
import { siteById } from './sites'

const haz = siteById('hazreviews')

/**
 * Fabricated, not registered. These functions take a Site and read only its
 * `slug`, so a second one need not exist in the registry — which keeps the
 * two-site path arithmetic covered while a single site is configured.
 * `isSiteScopedPath` is the exception: it validates against the registry, so its
 * tests below use real slugs.
 */
const kuwait = { id: 'kwt', name: 'Kuwait', domain: 'kwt.com', slug: 'kuwait', color: '#12A150' }

function page(label: string) {
  const found = NAV_PAGES.find((p) => p.label === label)
  if (!found) throw new Error(`no nav page labelled '${label}'`)
  return found
}

describe('hrefFor', () => {
  it('resolves a site page to the active property slug', () => {
    expect(hrefFor(page('Rankings'), kuwait)).toBe('/kuwait/rankings')
  })

  // Home is the site-agnostic root, so it must stay '/' whichever property is
  // in view — not '/kuwait', and not '/' with a trailing segment.
  it('resolves Home to the root whichever property is active', () => {
    expect(hrefFor(page('Home'), kuwait)).toBe('/')
    expect(hrefFor(page('Home'), haz)).toBe('/')
  })

  it('leaves a global page unscoped whichever property is active', () => {
    expect(hrefFor(page('Audit'), kuwait)).toBe('/log')
    expect(hrefFor(page('Audit'), haz)).toBe('/log')
  })
})

describe('isActive', () => {
  // '/' is a prefix of literally every path, so a boundary test would leave Home
  // lit on every page in the app.
  it('matches the root exactly', () => {
    expect(isActive('/', '/', kuwait)).toBe(true)
    expect(isActive('/kuwait', '/', kuwait)).toBe(false)
    expect(isActive('/kuwait/rankings', '/', kuwait)).toBe(false)
    expect(isActive('/log', '/', kuwait)).toBe(false)
  })

  // Same reasoning one level down: a property root is a prefix of its modules.
  it('matches a property root exactly', () => {
    expect(isActive('/kuwait', '/kuwait', kuwait)).toBe(true)
    expect(isActive('/kuwait/rankings', '/kuwait', kuwait)).toBe(false)
  })

  it('keeps Rankings lit inside a group', () => {
    expect(isActive('/kuwait/rankings/rabona', '/kuwait/rankings', kuwait)).toBe(true)
  })

  // The reason a bare startsWith is not enough: a sibling route whose path
  // merely begins with the same characters must not light the row.
  it('respects the slash boundary', () => {
    expect(isActive('/kuwait/rankings-archive', '/kuwait/rankings', kuwait)).toBe(false)
  })

  it('matches a global page', () => {
    expect(isActive('/log', '/log', kuwait)).toBe(true)
    expect(isActive('/how-it-works', '/log', kuwait)).toBe(false)
  })
})

describe('switchSiteHref', () => {
  it('carries the current module to the new property', () => {
    expect(switchSiteHref('/hazreviews/rankings', kuwait)).toBe('/kuwait/rankings')
  })

  // Group membership is derived per property, so a group with no rows on the
  // target would render an empty view. The grid reflects real data instead.
  it('drops the group segment', () => {
    expect(switchSiteHref('/hazreviews/rankings/rabona', kuwait)).toBe('/kuwait/rankings')
  })

  // Clicking the property you are already on must not cost you your place.
  it('is a no-op for the property already in view', () => {
    expect(switchSiteHref('/hazreviews/rankings/rabona', haz)).toBe('/hazreviews/rankings/rabona')
  })

  it('stays on the property root', () => {
    expect(switchSiteHref('/hazreviews', kuwait)).toBe('/kuwait')
  })

  // Global pages are not scoped to a property, so there is no module to carry.
  it('falls back to the property root from a global page', () => {
    expect(switchSiteHref('/log', kuwait)).toBe('/kuwait')
    expect(switchSiteHref('/admin/users', kuwait)).toBe('/kuwait')
  })

  it('falls back to the property root for an unrecognised module', () => {
    expect(switchSiteHref('/hazreviews/bogus', kuwait)).toBe('/kuwait')
  })

  it('falls back to the property root for an empty path', () => {
    expect(switchSiteHref('/', kuwait)).toBe('/kuwait')
  })
})

describe('pagesIn', () => {
  // Home and the global links are separate groups because the Sites disclosure
  // renders BETWEEN them, and a disclosure is not a page it could sort against.
  it('keeps Home alone in its group', () => {
    expect(pagesIn('home', false).map((p) => p.label)).toEqual(['Home'])
  })

  it('orders the global group as Ask AI, How It Works', () => {
    expect(pagesIn('global', false).map((p) => p.label)).toEqual(['Ask AI', 'How It Works'])
  })

  // Order IS the contract: this is exactly what a site card lists, top to bottom.
  it('lists the six per-site tools in card order', () => {
    expect(pagesIn('site', false).map((p) => p.label)).toEqual([
      'SEO',
      'Health',
      'PageSpeed',
      'Rankings',
      'Backlinks',
      'QA',
    ])
  })

  // Every site tool must be carryable across a site switch, or changing site from
  // one tool dumps you on Home instead of the same tool on the new site.
  it('carries every site tool across a site change', () => {
    for (const page of pagesIn('site', false)) {
      expect(switchSiteHref(`/hazreviews/${page.path}`, kuwait)).toBe(`/kuwait/${page.path}`)
    }
  })

  it('orders the system group as Trash, Audit, Manage', () => {
    expect(pagesIn('system', true).map((p) => p.label)).toEqual(['Trash', 'Audit', 'Manage'])
  })

  // Audit is the activity log, which every signed-in user could already read.
  // Pinning it to the bottom group must not quietly make it admin-only.
  it('keeps Audit visible to a non-admin but hides Trash and Manage', () => {
    expect(pagesIn('system', false).map((p) => p.label)).toEqual(['Audit'])
  })

  it('never leaks an admin page into the non-system groups', () => {
    for (const group of ['home', 'global', 'site'] as const) {
      expect(pagesIn(group, false)).toEqual(pagesIn(group, true))
    }
  })

  it('gives every page an icon', () => {
    expect(NAV_PAGES.every((p) => typeof p.icon === 'function')).toBe(true)
  })
})

// Drives the Sites disclosure's initial state: open where the property in view
// actually means something, closed on a page that ignores it.
describe('isSiteScopedPath', () => {
  it('is true for a site root and its modules', () => {
    expect(isSiteScopedPath('/hazreviews')).toBe(true)
    expect(isSiteScopedPath('/hazreviews/rankings/rabona')).toBe(true)
  })

  // Validated against the registry, not against "looks like a slug" — an
  // unregistered segment is a typo, not a site.
  it('is false for a slug that is not registered', () => {
    expect(isSiteScopedPath('/kuwait')).toBe(false)
  })

  it('is false for a global page', () => {
    expect(isSiteScopedPath('/log')).toBe(false)
    expect(isSiteScopedPath('/admin/users')).toBe(false)
    expect(isSiteScopedPath('/ask-ai')).toBe(false)
  })

  // '/' redirects to the default property, but at the moment it is read there is
  // no slug in the path, so it must not claim to be scoped.
  it('is false for the root and for an unknown slug', () => {
    expect(isSiteScopedPath('/')).toBe(false)
    expect(isSiteScopedPath('/nope/rankings')).toBe(false)
  })
})
