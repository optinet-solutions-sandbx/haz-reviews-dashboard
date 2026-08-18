import { Link, useOutletContext } from 'react-router-dom'
import type { HzOutletContext } from '../types'
import { pagesIn } from '../lib/nav'
import { SITES, siteMonogram, type Site } from '../lib/sites'
import { LoadError } from '../components/LoadError'
import { PageHeader } from '../components/PageHeader'

/**
 * The site directory.
 *
 * Driven entirely by the registry in `lib/sites.ts`, never by the database — so it
 * has no loading state and cannot be empty unless the registry is. That is why it
 * reads no snapshots at all.
 *
 * The tool list on each card is derived from the nav registry rather than copied
 * from the reference design. The sibling dashboard offers SEO, Health, PageSpeed,
 * Backlinks and QA per site; this app has none of those, and rendering them would
 * put five dead links on every card.
 */
export function Sites() {
  const ctx = useOutletContext<HzOutletContext>()

  return (
    <div className="animate-fade-up space-y-5">
      {/* The whole count is mono here, unlike Home's caption where only the date
          is — each follows its own reference. */}
      <PageHeader title="Sites">
        <span className="font-mono tabular-nums">
          {SITES.length} {SITES.length === 1 ? 'site' : 'sites'}
        </span>
      </PageHeader>

      {/* Surfaced ABOVE the grid, never instead of it. This page needs no snapshot
          data, but every card links into pages that do — so a failed load is worth
          reporting here, while replacing the grid with it would hide sites that
          are perfectly reachable. */}
      {ctx.snapshotsError && (
        <LoadError message={ctx.snapshotsError} onRetry={ctx.onReloadSnapshots} />
      )}

      {SITES.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SITES.map((site) => (
            <SiteTile key={site.id} site={site} />
          ))}
        </div>
      )}
    </div>
  )
}

function SiteTile({ site }: { site: Site }) {
  // Whatever the nav says a site actually has. One entry today (Rankings), so the
  // list grows by itself when a per-site page is added to the registry.
  const tools = pagesIn('site', false)

  return (
    // `relative` is what anchors the stretched link below. Without it the
    // pseudo-element would size itself against the page instead of the card.
    <section className="site-card relative overflow-hidden rounded-xl transition-all duration-150">
      {/* The site's own colour, as a top rule. Same hue as its dot in the sidebar
          and its bar in the leaderboard, so one site reads as one thing. */}
      <div className="h-[3px]" style={{ background: site.color }} aria-hidden />

      <div className="p-5">
        {/* `after:absolute after:inset-0` stretches this one link across the whole
            card, so clicking anywhere opens the site — without wrapping the tool
            links in another anchor, which is invalid HTML and leaves both
            untabbable. The list below then needs `relative z-10` to sit above the
            stretched layer and stay clickable in its own right. */}
        <Link
          to={`/${site.slug}`}
          className="site-card-link flex items-center gap-3 rounded-lg transition-colors after:absolute after:inset-0"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: site.color }}
          >
            {siteMonogram(site)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
              {site.name}
            </span>
            {/* Kept, though the reference has no such line: its own titles carry
                the TLD inside the name and ours do not, so this is the domain
                indicator rather than an addition. */}
            <span className="block truncate font-mono text-[10px]" style={{ color: 'var(--muted)' }}>
              {site.domain}
            </span>
          </span>
        </Link>

        <ul role="list" className="relative z-10 mt-4 space-y-1">
          {tools.map((page) => {
            const Icon = page.icon
            return (
              <li key={page.label}>
                <Link
                  to={`/${site.slug}/${page.path}`}
                  className="site-tool flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors"
                  style={{ color: 'var(--text-2)' }}
                >
                  <span style={{ color: 'var(--muted-3)' }}>
                    <Icon size={14} />
                  </span>
                  <span>{page.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

/**
 * Reachable only if the registry is emptied, since sites are code rather than
 * rows. There is deliberately no "Add site" button: this app cannot create one at
 * runtime, and a button that did nothing would be worse than none.
 */
function EmptyState() {
  return (
    <div
      className="rounded-xl px-6 py-12 text-center"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
    >
      <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
        No sites yet
      </h2>
      <p
        className="mx-auto max-w-[420px] pt-2 text-[12px] leading-relaxed"
        style={{ color: 'var(--text-2)' }}
      >
        Sites are configured in code, not added from the dashboard. Add an entry to{' '}
        <code className="font-mono text-[11px]" style={{ color: 'var(--ink)' }}>
          src/lib/sites.ts
        </code>{' '}
        and it will appear here — that one entry is all a new site needs.
      </p>
    </div>
  )
}
