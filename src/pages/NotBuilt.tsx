import { Link } from 'react-router-dom'
import { useOutletContext } from 'react-router-dom'
import type { HzOutletContext } from '../types'
import { PageHeader } from '../components/PageHeader'

/**
 * A real route behind a nav row whose feature does not exist yet.
 *
 * These rows exist because the sidebar mirrors the sibling dashboard's nav,
 * which has pages this app has not built. The alternative was to let the row
 * point at nothing — and an unmatched path hits the catch-all route, which
 * redirects to the default property, so the row would appear to work while
 * silently dumping the user on Home. A page that says what it is beats a
 * redirect that lies.
 */
export function NotBuilt({ title, note }: { title: string; note: string }) {
  const ctx = useOutletContext<HzOutletContext>()

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title={title}>Not built on this dashboard yet</PageHeader>
      <div
        className="max-w-[560px] rounded-xl p-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
      >
        {/* No heading here: PageHeader already names the page, and repeating it
            reads as two different sections. */}
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {note}
        </p>
        <Link
          to={`/${ctx.activeSite.slug}`}
          className="mt-5 inline-block rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
          style={{ background: 'var(--btn-ink)' }}
        >
          Back to {ctx.activeSite.name}
        </Link>
      </div>
    </div>
  )
}
