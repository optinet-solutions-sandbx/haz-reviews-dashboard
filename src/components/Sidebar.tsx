import { ChevronDown, ChevronsLeft, ChevronsRight, LogIn, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { KeywordGroup } from '../types'
import { groupSlug } from '../lib/groups'
import {
  SITES_HREF,
  hrefFor,
  isActive,
  isSiteScopedPath,
  pagesIn,
  switchSiteHref,
  type NavPage,
} from '../lib/nav'
import { SitesIcon, UserIcon } from './icons'
import { SITES, type Site } from '../lib/sites'

export const SIDEBAR_KEY = 'hz_sidebar_expanded'

/**
 * Rail widths. FOUR places must agree: these two literals, the spacer in
 * App.tsx, and TOGGLE_LEFT below. The aside is `fixed`, so nothing in the flex
 * row reserves its footprint automatically — the spacer does that, and both
 * animate on the same 200ms transition so the page reflows instead of the rail
 * floating over content.
 */
export const RAIL_EXPANDED = 240
export const RAIL_COLLAPSED = 64

/** The 24px toggle straddles the rail's right edge: width − half the button. */
const TOGGLE_LEFT = { expanded: RAIL_EXPANDED - 12, collapsed: RAIL_COLLAPSED - 12 }

export function loadSidebarExpanded(): boolean {
  try {
    // Default to expanded: the labels are how a first-time user learns the nav.
    return localStorage.getItem(SIDEBAR_KEY) !== 'false'
  } catch {
    return true
  }
}

export function saveSidebarExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(expanded))
  } catch {
    // Private-mode browsers throw. The preference simply will not persist.
  }
}

/**
 * Shared row geometry. Every row carries a 2px left border at rest —
 * transparent unless active — so activating or hovering a row recolours it
 * rather than resizing it. Swapping padding for a border instead would shift the
 * label 2px on every state change.
 *
 * The 10px inset is load-bearing: 8px from the nav's `px-2`, plus the 2px
 * border, puts content at 20px, which is where an 18px icon reaches the same
 * optical centre (29px) as the 36px monogram inset 12px (30px). Change one and
 * adjust the padding to restore the agreement — never the monogram's inset.
 */
const ROW =
  'nav-row flex items-center gap-3 rounded-lg border-l-2 border-l-transparent py-2 pl-[10px] pr-3 text-[12px] font-semibold transition-colors'

/** Active rows: azure border, tinted ground, navy label — the icon tints separately. */
const ACTIVE_ROW = {
  background: 'var(--active-tint)',
  borderLeftColor: 'var(--brand-blue)',
  color: 'var(--navy-text)',
} as const

const IDLE_ROW = { color: 'var(--muted)' } as const

/** An 18px box, so an icon and a status dot land on the same optical column. */
const ICON_BOX = 'flex w-[18px] shrink-0 items-center justify-center'

const HAIRLINE = '1px solid var(--border-3)'

interface SidebarProps {
  expanded: boolean
  onToggleExpanded: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
  isAdmin: boolean
  groups: KeywordGroup[]
  activeSite: Site
  email: string | null
  /**
   * Whether there is a real session to end. Separate from `email` on purpose:
   * the address can be forced by VITE_DEV_FORCE_EMAIL, a session cannot, and
   * deriving the action from the address is what made Sign out a dead button.
   */
  canSignOut: boolean
  onSignIn: () => void
  onSignOut: () => void
}

export function Sidebar(props: SidebarProps) {
  // Closing the drawer on navigation is NOT done here: `mobileOpen` belongs to
  // Layout, and React forbids setting a parent's state from a child's render.
  // Layout adjusts it during its own render instead — see App.tsx.
  useEffect(() => {
    if (!props.mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [props.mobileOpen])

  return (
    <>
      {props.mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={props.onCloseMobile}
          aria-hidden
        />
      )}

      {/* ONE tree, two modes. Below md it is a drawer driven by `translate`;
          at md and up it is a persistent rail driven by `width`. Rendering a
          second aside for mobile would duplicate every row of markup. */}
      <aside
        id="hz-rail"
        className={`fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col overflow-hidden transition-[width,transform] duration-200 ease-out md:translate-x-0 ${
          props.mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${props.expanded ? 'md:w-[240px]' : 'md:w-[64px]'}`}
        style={{
          background: 'var(--surface)',
          borderRight: '1px solid var(--border-2)',
          boxShadow: props.mobileOpen ? '8px 0 32px rgba(0,0,0,0.18)' : 'none',
        }}
      >
        <SidebarBody {...props} />
      </aside>

      {/* A `fixed` sibling, never a child: the aside is `overflow-hidden`, so a
          button straddling its right edge would be clipped. `left` animates in
          lockstep with the rail width. */}
      <button
        type="button"
        onClick={props.onToggleExpanded}
        aria-label={props.expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        title={props.expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={props.expanded}
        aria-controls="hz-rail"
        className="rail-toggle fixed top-7 z-50 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-all duration-200 ease-out md:flex"
        // `left` is the only computed value; the rest of the look lives in
        // index.css, because a hover state cannot be expressed inline at all.
        style={{ left: props.expanded ? TOGGLE_LEFT.expanded : TOGGLE_LEFT.collapsed }}
      >
        {props.expanded ? <ChevronsLeft size={13} /> : <ChevronsRight size={13} />}
      </button>
    </>
  )
}

function SidebarBody({
  expanded,
  mobileOpen,
  isAdmin,
  groups,
  activeSite,
  email,
  canSignOut,
  onSignIn,
  onSignOut,
}: SidebarProps) {
  const location = useLocation()

  // The drawer is always full width, so labels must show there even while the
  // desktop rail is collapsed.
  const showLabels = expanded || mobileOpen

  const homePages = pagesIn('home', isAdmin)
  const globalPages = pagesIn('global', isAdmin)
  const systemPages = pagesIn('system', isAdmin)

  // Open where the property choice is live, closed on a page that ignores it.
  // Adjusted during render rather than in an effect — React's documented pattern
  // for reacting to a changed input without a second render pass.
  const scoped = isSiteScopedPath(location.pathname)
  const [sitesOpen, setSitesOpen] = useState(scoped)
  const [prevScoped, setPrevScoped] = useState(scoped)
  if (scoped !== prevScoped) {
    setPrevScoped(scoped)
    setSitesOpen(scoped)
  }

  // The active group comes from the URL, not from local state, so a shared link
  // highlights the right row and back/forward always stay in sync.
  //
  // The path is '/<site>/rankings/<group>', so 'rankings' is no longer the first
  // segment and the group slug sits at index 3.
  const inRankings = location.pathname.includes('/rankings')
  const activeSlug = inRankings ? location.pathname.split('/')[3] : undefined

  const labelClass = `whitespace-nowrap text-glow transition-opacity duration-150 ${
    showLabels ? 'opacity-100' : 'opacity-0'
  }`

  return (
    <>
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-3 px-3 pb-4 pt-5"
        style={{ borderBottom: HAIRLINE }}
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-[13px] font-bold tracking-wider text-white"
          style={{ background: 'var(--brand-navy)' }}
        >
          HZ
        </div>
        <div
          className={`min-w-0 flex-1 transition-opacity duration-150 ${
            showLabels ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div
            className="truncate font-display text-[14px] font-bold leading-none tracking-widest"
            style={{ color: 'var(--navy-text)' }}
          >
            HAZ REVIEWS
          </div>
          {/* A fixed word, not a count. The properties are listed under Sites
              directly below, so a running total here only competed with them —
              and it went stale the moment a third was added to the registry. */}
          <div
            className="mt-1 truncate text-[9px] uppercase tracking-[0.12em]"
            style={{ color: 'var(--muted)' }}
          >
            Dashboard
          </div>
        </div>
      </div>

      {/* The nav owns the scroll and the vertical distribution: `flex-1` makes it
          take the slack, so `mt-auto` on the admin group pins it to the bottom
          without a spacer div. */}
      <nav
        className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 py-2"
        style={{ borderTop: HAIRLINE }}
      >
        {/* Home sits above the disclosure; Ask AI and How It Works below it. */}
        {homePages.map((page) => (
          <NavRow
            key={page.label}
            page={page}
            site={activeSite}
            pathname={location.pathname}
            labelClass={labelClass}
          />
        ))}

        {/* Sites: a link and a disclosure toggle side by side, which is how the
            reference builds it. This used to be one button that only disclosed,
            because there was no /sites page to navigate to; now there is, so the
            row does both — the label opens the directory, the chevron reveals the
            sites inline without leaving the page. */}
        <div className="flex items-stretch gap-1">
          <Link
            to={SITES_HREF}
            aria-current={location.pathname === SITES_HREF ? 'page' : undefined}
            title="Sites"
            className={`${ROW} flex-1`}
            style={location.pathname === SITES_HREF ? ACTIVE_ROW : IDLE_ROW}
          >
            <span
              className={ICON_BOX}
              style={{
                color:
                  location.pathname === SITES_HREF ? 'var(--brand-blue)' : 'var(--muted-3)',
              }}
            >
              <SitesIcon size={18} />
            </span>
            <span className={labelClass}>Sites</span>
          </Link>
          {showLabels && (
            <button
              type="button"
              onClick={() => setSitesOpen((open) => !open)}
              aria-expanded={sitesOpen}
              aria-controls="hz-sites"
              aria-label={sitesOpen ? 'Collapse sites' : 'Expand sites'}
              title={sitesOpen ? 'Collapse sites' : 'Expand sites'}
              className="nav-row flex w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--muted-3)' }}
            >
              <ChevronDown
                size={16}
                className={`transition-transform duration-150 ${sitesOpen ? '' : '-rotate-90'}`}
                aria-hidden
              />
            </button>
          )}
        </div>

        {/* Collapsed by `hidden`, not unmounted: `aria-controls` must resolve to
            a real element for the disclosure to be announced correctly. */}
        <div id="hz-sites" className={sitesOpen ? 'flex flex-col gap-0.5' : 'hidden'}>
          {SITES.map((site) => {
            const active = site.id === activeSite.id
            return (
              <Link
                key={site.id}
                // Switching property keeps the module you were reading rather
                // than bouncing you back to Home.
                to={switchSiteHref(location.pathname, site)}
                // Not 'page': on '/hazreviews/rankings' this row is the current
                // property but it is not the current page, and claiming
                // otherwise misreports the location to a screen reader.
                aria-current={active ? 'true' : undefined}
                title={site.name}
                className={`${ROW} pl-[22px]`}
                style={active ? ACTIVE_ROW : IDLE_ROW}
              >
                <span className={ICON_BOX} aria-hidden>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: site.color }} />
                </span>
                <span className={labelClass}>{site.name}</span>
              </Link>
            )
          })}
        </div>

        {globalPages.map((page) => (
          <NavRow
            key={page.label}
            page={page}
            site={activeSite}
            pathname={location.pathname}
            labelClass={labelClass}
          />
        ))}

        {/* Contextual group list — only inside the rankings section. Indented one
            level below the nav on purpose: it is a sub-selection within Rankings,
            so sharing the nav's optical column would flatten the hierarchy.

            Carries its own divider now that the property section above it is
            gone; without one it would read as a continuation of the global
            links. */}
        {inRankings && showLabels && groups.length > 0 && (
          <div className="mt-1 flex flex-col">
            <div className="mx-1 mb-2 shrink-0" style={{ borderTop: HAIRLINE }} />
            {groups.map((g) => {
              const slug = groupSlug(g.name)
              const active = activeSlug === slug
              return (
                <Link
                  key={g.name}
                  to={`/${activeSite.slug}/rankings/${slug}`}
                  aria-current={active ? 'page' : undefined}
                  title={g.name}
                  // 22px, not 10: one level in from the nav's own column, so the
                  // list reads as a sub-selection within Rankings.
                  className={`${ROW} rounded-md py-1.5 pl-[22px] pr-2 text-[11px] font-medium`}
                  style={active ? ACTIVE_ROW : IDLE_ROW}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: g.color }}
                    aria-hidden
                  />
                  <span className="whitespace-nowrap text-glow">{g.name}</span>
                </Link>
              )
            })}
          </div>
        )}

        {/* Pinned to the bottom, separated by a hairline: these rows differ
            enormously in blast radius from the ones above, so they must not read
            as more of the same list. */}
        {systemPages.length > 0 && (
          <div
            className="mt-auto flex shrink-0 flex-col gap-0.5 pt-2"
            style={{ borderTop: HAIRLINE }}
          >
            {systemPages.map((page) => (
              <NavRow
                key={page.label}
                page={page}
                site={activeSite}
                pathname={location.pathname}
                labelClass={labelClass}
              />
            ))}
          </div>
        )}
      </nav>

      {/* Footer — identity only, matching the sibling dashboard.

          The ADDRESS and the ACTION are decided separately, and that separation is
          the whole fix for a bug this shipped with. The address can be forced by
          VITE_DEV_FORCE_EMAIL — rendering it with no backend is what the flag is
          for — but a session cannot be forced. Deciding the action from the address
          therefore offered "Sign out" with nothing to sign out of, and
          supabase.auth.signOut() short-circuits in that state: no request, no
          error, no visible change. See getIdentityGate. */}
      <div className="mt-auto shrink-0 px-2 py-3" style={{ borderTop: HAIRLINE }}>
        <div className={showLabels ? undefined : 'flex flex-col items-center gap-2 py-1'}>
          {email && <AddressRow email={email} showLabels={showLabels} />}
          {canSignOut ? (
            <SignOutRow showLabels={showLabels} onSignOut={onSignOut} />
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              title="Sign in"
              className={`${ROW} w-full cursor-pointer`}
              style={IDLE_ROW}
            >
              <span className={ICON_BOX} style={{ color: 'var(--muted-3)' }}>
                <LogIn size={18} />
              </span>
              <span className={labelClass}>Sign in</span>
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * One row, used by all three nav groups. Extracted because the groups differ
 * only in where they render — triplicating the markup is how the active
 * treatment in one group drifts from another.
 */
function NavRow({
  page,
  site,
  pathname,
  labelClass,
}: {
  page: NavPage
  site: Site
  pathname: string
  labelClass: string
}) {
  const { label, icon: Icon } = page
  const href = hrefFor(page, site)
  const active = isActive(pathname, href, site)
  return (
    <Link
      to={href}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={ROW}
      style={active ? ACTIVE_ROW : IDLE_ROW}
    >
      {/* The tint lives on the wrapper, not the svg, precisely so the icon can
          differ from the label colour. */}
      <span
        className={ICON_BOX}
        style={{ color: active ? 'var(--brand-blue)' : 'var(--muted-3)' }}
      >
        <Icon size={18} />
      </span>
      <span className={labelClass}>{label}</span>
    </Link>
  )
}

/**
 * WHO the footer is showing. Rendered whenever there is an address, which
 * includes a forced one with no session behind it — that is the case
 * VITE_DEV_FORCE_EMAIL exists to produce.
 *
 * Two layouts, not one that adapts: collapsed shows the avatar alone, expanded
 * puts the address beside it. A single flex row cannot do both without the
 * address either overflowing the 64px rail or wrapping.
 */
function AddressRow({ email, showLabels }: { email: string; showLabels: boolean }) {
  if (!showLabels) {
    return (
      <span
        title={email}
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{ background: 'var(--navy-tint)', color: 'var(--navy-text)' }}
      >
        <UserIcon size={18} />
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2 px-2 pb-2">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ background: 'var(--navy-tint)', color: 'var(--navy-text)' }}
      >
        <UserIcon size={18} />
      </span>
      {/* 12px, not the 10px mono this used: the address is prose, not data. */}
      <p className="min-w-0 truncate text-xs" style={{ color: 'var(--muted)' }} title={email}>
        {email}
      </p>
    </div>
  )
}

/**
 * Ending the session. Rendered only when there IS one — the caller decides that
 * from `canSignOut`, never from whether an address is on screen.
 */
function SignOutRow({
  showLabels,
  onSignOut,
}: {
  showLabels: boolean
  onSignOut: () => void
}) {
  if (!showLabels) {
    return (
      <button
        type="button"
        onClick={onSignOut}
        title="Sign out"
        aria-label="Sign out"
        // `nav-row` carries the hover ground; the class contributes no
        // geometry of its own, so the 36px square is unaffected.
        //
        // Kept at --muted, NOT the source's lighter neutral-400 tint. Collapsed,
        // the icon IS the entire control, and at 2.6:1 that tint fails
        // SC 1.4.11 — the shared system's own rule bans it for exactly this
        // case and permits it only beside a visible label.
        className="nav-row flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-colors"
        style={{ color: 'var(--muted)' }}
      >
        <LogOut size={18} />
      </button>
    )
  }

  return (
    /* Not built on ROW. The source insets this row with pl-4 and no left
       border, which puts its glyph 4px right of the nav's optical column —
       a deliberate copy of that measurement, not an oversight. Sharing ROW
       would silently pull it back to 20px. */
    <button
      type="button"
      onClick={onSignOut}
      title="Sign out"
      className="nav-row flex w-full cursor-pointer items-center gap-3 rounded-lg py-2 pl-4 pr-3 text-[12px] font-semibold transition-colors"
      style={{ color: 'var(--muted)' }}
    >
      {/* Unwrapped, so the glyph inherits the row's colour instead of taking a
          separate tint — the source draws icon and label alike here. */}
      <LogOut size={18} className="shrink-0" />
      <span className="whitespace-nowrap text-glow">Sign out</span>
    </button>
  )
}
