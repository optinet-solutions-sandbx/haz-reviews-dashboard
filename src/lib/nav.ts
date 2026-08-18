import {
  AskAiIcon,
  AuditIcon,
  BacklinksIcon,
  HealthIcon,
  HomeIcon,
  HowItWorksIcon,
  ManageIcon,
  PageSpeedIcon,
  QaIcon,
  RankingsIcon,
  SeoIcon,
  TrashIcon,
  type NavIcon,
} from '../components/icons'
import { SITE_BY_SLUG, type Site } from './sites'

/**
 * THE NAV REGISTRY — the single source of nav truth, alongside the site registry
 * in `sites.ts` and the group registry in `groups.ts`.
 *
 * Nav lives here rather than inside Sidebar so the path arithmetic is pure and
 * testable in the node test environment. Every rule below (which segment is the
 * module, when a row is active, where a property switch lands) is a place where
 * a mistake is silent — the wrong row simply lights up.
 */

/**
 * Where a row renders, which is not derivable from its other flags: Home is
 * property-scoped yet belongs at the top, while Rankings is property-scoped and
 * belongs in the contextual section.
 *
 * - `home`   — the landing row, above the Sites disclosure
 * - `global` — site-agnostic rows, below the disclosure
 * - `site`   — contextual, under the name of the property in view
 * - `system` — pinned to the bottom of the nav by `mt-auto`
 *
 * `home` and `global` are separate rather than one list because the Sites
 * disclosure renders BETWEEN them, and a disclosure is not a page that could
 * take its position from this registry.
 */
export type NavGroup = 'home' | 'global' | 'site' | 'system'

export interface NavPage {
  /** Path SUFFIX, not a full href. `hrefFor` resolves it against a property. */
  path: string
  label: string
  icon: NavIcon
  /** Global pages are not scoped to a property and live at the root. */
  global: boolean
  adminOnly?: boolean
  group: NavGroup
}

/**
 * Declaration order is render order within each group.
 *
 * `Audit` is the activity log and `Manage` is user access — the two pages this
 * app already had under different names. They sit in the bottom group to match
 * the sibling dashboard, but only `Trash` and `Manage` are admin-gated: `Audit`
 * was readable by any signed-in user before, and moving a row must not quietly
 * revoke access to the page behind it.
 */
export const NAV_PAGES: NavPage[] = [
  // Site-agnostic: Home is the root URL, not the property root. `global` with an
  // empty path is what makes `hrefFor` emit '/'.
  { path: '', label: 'Home', icon: HomeIcon, global: true, group: 'home' },
  { path: 'ask-ai', label: 'Ask AI', icon: AskAiIcon, global: true, group: 'global' },
  {
    path: 'how-it-works',
    label: 'How It Works',
    icon: HowItWorksIcon,
    global: true,
    group: 'global',
  },
  // The per-site tools, in the order the site card lists them. The sidebar has no
  // site section, so these draw no rows there — they render on the Sites page and
  // feed SITE_MODULES below, which is what lets switchSiteHref carry the page you
  // are on across a site change.
  //
  // Only 'rankings' has a feature behind it. The other five are declared here and
  // routed to NotBuilt: a tool list is only useful if every entry leads somewhere
  // that says what it is.
  { path: 'seo', label: 'SEO', icon: SeoIcon, global: false, group: 'site' },
  { path: 'health', label: 'Health', icon: HealthIcon, global: false, group: 'site' },
  { path: 'pagespeed', label: 'PageSpeed', icon: PageSpeedIcon, global: false, group: 'site' },
  { path: 'rankings', label: 'Rankings', icon: RankingsIcon, global: false, group: 'site' },
  { path: 'backlinks', label: 'Backlinks', icon: BacklinksIcon, global: false, group: 'site' },
  { path: 'qa', label: 'QA', icon: QaIcon, global: false, group: 'site' },
  { path: 'trash', label: 'Trash', icon: TrashIcon, global: true, adminOnly: true, group: 'system' },
  { path: 'log', label: 'Audit', icon: AuditIcon, global: true, group: 'system' },
  {
    path: 'admin/users',
    label: 'Manage',
    icon: ManageIcon,
    global: true,
    adminOnly: true,
    group: 'system',
  },
]

/**
 * The site directory. Declared separately and deliberately NOT in NAV_PAGES: it
 * renders as a link paired with a disclosure toggle rather than as a plain row,
 * so every group filter would have to special-case it.
 */
export const SITES_HREF = '/sites'

/** The modules a property switch can carry across — site pages with a path. */
const SITE_MODULES = new Set(
  NAV_PAGES.filter((p) => p.group === 'site' && !p.global && p.path).map((p) => p.path),
)

export function pagesIn(group: NavGroup, isAdmin: boolean): NavPage[] {
  return NAV_PAGES.filter((p) => p.group === group && (isAdmin || !p.adminOnly))
}

/**
 * Whether the property in view actually means anything on this path. Drives the
 * Sites disclosure's initial state — open where the choice is live, closed on a
 * page that ignores it.
 *
 * Read off the path, not off the resolved site: `activeSite` falls back to the
 * default for every unscoped route, so it can never answer this question.
 */
export function isSiteScopedPath(pathname: string): boolean {
  const first = pathname.split('/').filter(Boolean)[0]
  return Boolean(first && SITE_BY_SLUG.has(first))
}

export function hrefFor(page: NavPage, site: Site): string {
  if (page.global) return `/${page.path}`
  // Home's path is empty; joining it unguarded emits a trailing slash, which no
  // route matches.
  return page.path ? `/${site.slug}/${page.path}` : `/${site.slug}`
}

/**
 * Roots match exactly; everything else matches on a slash boundary, so
 * `/kuwait/rankings/rabona` keeps Rankings lit while a hypothetical
 * `/kuwait/rankings-archive` does not.
 *
 * Both roots need the exception because each is a prefix of everything beneath
 * it: a boundary test would leave Home lit on every page in the app, and a
 * property root lit alongside its own modules.
 *
 * The '/' case is spelled out rather than left to the boundary test. That test
 * happens to reject it today — `${'/'}/` is '//', which nothing matches — but
 * that is an accident of string concatenation, not a rule, and normalising the
 * trailing slash would silently break Home.
 */
export function isActive(pathname: string, href: string, site: Site): boolean {
  if (href === '/' || href === `/${site.slug}`) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Where the property switcher lands: the same module under the new property, so
 * switching does not bounce you back to Home.
 *
 * The group segment is deliberately dropped when the property actually changes.
 * Group membership is derived per property, so carrying `rankings/rabona` across
 * can land on a group with no rows on the target; the group grid reflects that
 * property's real data instead. A global page has no module to carry, and an
 * unrecognised segment falls back rather than producing a URL that only the
 * catch-all route can rescue.
 */
export function switchSiteHref(pathname: string, to: Site): string {
  const segments = pathname.split('/').filter(Boolean)
  if (!segments[0] || !SITE_BY_SLUG.has(segments[0])) return `/${to.slug}`
  // Already here. Nothing is switching, so nothing should be dropped — the
  // group-shedding rule below exists for a change of property, not for a click
  // on the property you are reading.
  if (segments[0] === to.slug) return pathname
  const module = segments[1]
  if (!module || !SITE_MODULES.has(module)) return `/${to.slug}`
  return `/${to.slug}/${module}`
}
