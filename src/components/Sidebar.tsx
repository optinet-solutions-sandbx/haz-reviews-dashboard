import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  History,
  LayoutDashboard,
  TrendingUp,
  Upload,
  Users,
} from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { KeywordGroup, WriteGate } from '../types'
import { groupSlug } from '../lib/groups'
import { SITES, type Site } from '../lib/sites'

/** Paths are suffixes. Site pages hang off the active property's slug; the two
 *  `global` pages are not scoped to a property and live at the root. */
const PAGES = [
  { path: '', label: 'Overview', icon: LayoutDashboard, global: false },
  { path: 'rankings', label: 'Rankings', icon: TrendingUp, global: false },
  { path: 'log', label: 'Activity', icon: History, global: true },
  { path: 'how-it-works', label: 'How it works', icon: HelpCircle, global: true },
] as const

const ADMIN_PAGE = { path: 'admin/users', label: 'Users', icon: Users, global: true } as const

function hrefFor(page: { path: string; global: boolean }, site: Site): string {
  if (page.global) return `/${page.path}`
  return page.path ? `/${site.slug}/${page.path}` : `/${site.slug}`
}

export const SIDEBAR_KEY = 'hz_sidebar_expanded'

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

interface SidebarProps {
  expanded: boolean
  onToggleExpanded: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
  isAdmin: boolean
  groups: KeywordGroup[]
  activeSite: Site
  lastUpdated: string | null
  writeGate: WriteGate
  onOpenUpload: () => void
}

export function Sidebar(props: SidebarProps) {
  const location = useLocation()

  // Close the drawer on navigation, and release the body scroll lock with it.
  useEffect(() => {
    props.onCloseMobile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

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
      {/* Desktop rail */}
      <aside
        className={`relative hidden shrink-0 transition-[width] duration-200 ease-out sm:block ${
          props.expanded ? 'w-[240px]' : 'w-[64px]'
        }`}
        style={{
          background: 'var(--surface)',
          borderRight: '1px solid var(--border-2)',
          zIndex: 20,
        }}
      >
        <SidebarBody {...props} expanded={props.expanded} />

        {/* Straddles the seam between rail and content. */}
        <button
          type="button"
          onClick={props.onToggleExpanded}
          aria-label={props.expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className="absolute -right-3 top-7 flex h-6 w-6 items-center justify-center rounded-full transition-colors"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
          }}
        >
          {props.expanded ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
        </button>
      </aside>

      {/* Mobile drawer */}
      {props.mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          onClick={props.onCloseMobile}
          aria-hidden
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[240px] transition-transform duration-200 ease-out sm:hidden ${
          props.mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          background: 'var(--surface)',
          borderRight: '1px solid var(--border-2)',
          boxShadow: props.mobileOpen ? '8px 0 32px rgba(0,0,0,0.18)' : 'none',
        }}
      >
        <SidebarBody {...props} expanded />
      </aside>
    </>
  )
}

function SidebarBody({
  expanded,
  isAdmin,
  groups,
  activeSite,
  lastUpdated,
  writeGate,
  onOpenUpload,
}: SidebarProps) {
  const location = useLocation()
  const pages = isAdmin ? [...PAGES, ADMIN_PAGE] : PAGES

  // The active group comes from the URL, not from local state, so a shared link
  // highlights the right row and back/forward always stay in sync.
  //
  // The path is '/<site>/rankings/<group>', so 'rankings' is no longer the first
  // segment and the group slug sits at index 3.
  const inRankings = location.pathname.includes('/rankings')
  const activeSlug = inRankings ? location.pathname.split('/')[3] : undefined

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 pb-4 pt-5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-[13px] font-bold text-white"
          style={{ background: 'var(--brand-navy)' }}
        >
          HZ
        </div>
        <div
          className={`min-w-0 transition-opacity duration-150 ${
            expanded ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div
            className="truncate font-display text-[14px] font-semibold leading-tight"
            style={{ color: 'var(--ink)' }}
          >
            Haz Reviews
          </div>
          <div className="truncate font-mono text-[9px]" style={{ color: 'var(--muted-3)' }}>
            hazreviews.com
          </div>
        </div>
      </div>

      {/* Property switcher. A link per site rather than a select: with two
          options a dropdown costs an extra click and hides the alternative. */}
      <div className={expanded ? 'mb-3 px-3' : 'mb-3 px-2'}>
        {expanded && (
          <div
            className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--muted-3)' }}
          >
            Property
          </div>
        )}
        <div className="flex flex-col gap-1">
          {SITES.map((site) => {
            const active = site.id === activeSite.id
            return (
              <Link
                key={site.id}
                to={`/${site.slug}`}
                title={expanded ? undefined : site.name}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors"
                style={{
                  background: active ? 'var(--active-tint)' : undefined,
                  color: active ? 'var(--navy-text)' : 'var(--text-2)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: site.color }}
                  aria-hidden
                />
                <span
                  className={`truncate transition-opacity duration-150 ${
                    expanded ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  {site.name}
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2">
        {pages.map((page) => {
          const { label, icon: Icon } = page
          const href = hrefFor(page, activeSite)
          // Overview is an exact match; everything else is a prefix, so
          // /kuwait/rankings/rabona still lights up Rankings. A prefix test on
          // Overview would match every site page and light up both rows.
          const active =
            href === `/${activeSite.slug}`
              ? location.pathname === href
              : location.pathname.startsWith(href)
          return (
            <Link
              key={href}
              to={href}
              title={expanded ? undefined : label}
              className="flex items-center gap-2.5 rounded-lg py-2 text-[12px] font-medium transition-colors"
              style={
                active
                  ? {
                      background: 'var(--active-tint)',
                      borderLeft: '2px solid var(--brand-blue)',
                      // 12 − 2 so the label stays aligned with inactive rows.
                      paddingLeft: 10,
                      paddingRight: 12,
                      color: 'var(--navy-text)',
                    }
                  : { paddingLeft: 12, paddingRight: 12, color: 'var(--text-2)' }
              }
            >
              <Icon
                size={18}
                className="shrink-0"
                style={{ color: active ? 'var(--brand-blue)' : 'var(--muted)' }}
              />
              <span
                className={`truncate transition-opacity duration-150 ${
                  expanded ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Contextual group list — only inside the rankings section. */}
      {inRankings && expanded && groups.length > 0 && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col px-2">
          <div
            className="px-2 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--muted-3)' }}
          >
            Groups
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.map((g) => {
              const slug = groupSlug(g.name)
              const active = activeSlug === slug
              return (
                <Link
                  key={g.name}
                  to={`/${activeSite.slug}/rankings/${slug}`}
                  className="flex items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-[11px] transition-colors"
                  style={{
                    background: active ? 'var(--active-tint)' : undefined,
                    color: active ? 'var(--navy-text)' : 'var(--text-2)',
                  }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: g.color }}
                    aria-hidden
                  />
                  <span className="truncate">{g.name}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* Footer */}
      <div className="px-2 pb-4 pt-3">
        <button
          type="button"
          onClick={onOpenUpload}
          disabled={writeGate.disabled}
          title={writeGate.title}
          className="flex w-full items-center gap-2.5 rounded-lg py-2.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-50"
          style={{
            background: 'var(--brand-navy)',
            paddingLeft: expanded ? 12 : 0,
            paddingRight: expanded ? 12 : 0,
            justifyContent: expanded ? 'flex-start' : 'center',
          }}
        >
          <Upload size={15} className="shrink-0" />
          <span
            className={`truncate transition-opacity duration-150 ${
              expanded ? 'opacity-100' : 'opacity-0'
            }`}
          >
            Import Data
          </span>
        </button>

        {expanded && (
          <div className="px-1 pt-2.5 font-mono text-[9px]" style={{ color: 'var(--muted-3)' }}>
            {lastUpdated ? `Updated: ${lastUpdated}` : 'No data yet'}
          </div>
        )}
      </div>
    </div>
  )
}
