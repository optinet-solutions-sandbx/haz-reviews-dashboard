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
 * Adding a property is one entry here and nothing else — plus `abbr`, but only
 * when its initials collide with another entry's.
 *
 * ONE property is registered. The sibling shell's five Trybet properties were
 * listed here for a while and have been removed by request. That was safe only
 * because nothing had ever been imported under their ids — see CLAUDE.md
 * invariant 24, which is the whole hazard of deleting an entry. Nothing
 * downstream assumes a single site: the sidebar list, the site directory, the
 * upload target picker and Ask AI's scope picker all still map over `SITES`, so
 * restoring a property stays one entry.
 */
export interface Site {
  id: string
  name: string
  domain: string
  slug: string
  color: string
  /**
   * Overrides the derived monogram. Needed only where two names reduce to the
   * same initials: 'Haz Reviews (.ca)' and 'Haz Reviews (.com)' would both derive
   * HRC, and two identical tiles in the site directory are indistinguishable.
   *
   * No current entry needs one. The field stays because the collision is a
   * property of the deriver rather than of the entries that happened to trip it,
   * and a brand split across TLDs is the ordinary way to trip it again.
   */
  abbr?: string
}

export const SITES: Site[] = [
  {
    id: 'hazreviews',
    name: 'HAZREVIEWS',
    domain: 'hazreviews.com',
    slug: 'hazreviews',
    color: '#2F6FED',
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

/**
 * Monogram for a site tile — up to three characters, derived from the name.
 *
 * Pure and name-only so it can be tested without the registry. Components call
 * `siteMonogram` instead, or an entry's override would be bypassable.
 *
 * The sibling dashboard badges the TLD, because names differing only by suffix
 * reduce to the same initials — which is what happens the moment one brand is
 * registered twice ('Haz Reviews (.ca)' and 'Haz Reviews (.com)' both derive
 * HRC). A TLD badge is not the fix either, since two brands sharing a suffix
 * collide in turn, so the resolution stays in the registry: an explicit `abbr`
 * on the ambiguous entry, with a test holding the whole set distinct.
 */
export function siteInitials(name: string): string {
  const words = name
    // Split camelCase before flattening punctuation, or 'OnlineCasinoKuwait'
    // collapses into one word and yields 'ONL'.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return '?'
  // One word carries no initials to take, so use its opening letters instead.
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/**
 * The monogram actually rendered. Prefers an entry's `abbr`, so a collision is
 * resolved in the registry rather than by teaching the deriver about one
 * specific pair of names.
 */
export function siteMonogram(site: Site): string {
  return site.abbr ?? siteInitials(site.name)
}
