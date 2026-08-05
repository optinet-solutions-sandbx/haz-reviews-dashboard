/**
 * THE SITE REGISTRY — the single source of truth for tracked properties.
 *
 * `id` is written into snapshots.site and into every snapshot id. Once data
 * exists it can never change without a migration. `name`, `domain` and `color`
 * are presentation and can change freely.
 *
 * `slug` is the URL segment, deliberately separate from `id` so a long stored id
 * can have a short, typeable URL ('onlinecasinokuwait' → 'kuwait') without
 * touching stored data.
 *
 * Adding a third property is one entry here and nothing else.
 */
export interface Site {
  id: string
  name: string
  domain: string
  slug: string
  color: string
}

export const SITES: Site[] = [
  {
    id: 'hazreviews',
    name: 'HAZREVIEWS',
    domain: 'hazreviews.com',
    slug: 'hazreviews',
    color: '#2F6FED',
  },
  {
    id: 'onlinecasinokuwait',
    name: 'OnlineCasinoKuwait',
    domain: 'onlinecasinokuwait.com',
    slug: 'kuwait',
    color: '#12A150',
  },
]

export const DEFAULT_SITE_ID = 'hazreviews'

export const SITE_BY_ID = new Map(SITES.map((s) => [s.id, s]))
export const SITE_BY_SLUG = new Map(SITES.map((s) => [s.slug, s]))

/**
 * Never throws. A stored id that is no longer in the registry — or a typo in a
 * URL — resolves to the default rather than crashing a render deep in the tree.
 */
export function siteById(id: string): Site {
  return SITE_BY_ID.get(id) ?? SITE_BY_ID.get(DEFAULT_SITE_ID)!
}
