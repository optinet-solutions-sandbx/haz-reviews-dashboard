/**
 * Every page's own header row.
 *
 * Titles used to live in the Topbar, which meant one component had to know the
 * name of every route — a lookup table keyed by path fragment that went stale
 * whenever a route was renamed. A page knows its own name.
 *
 * `items-baseline` rather than `items-center`: the caption is much smaller than
 * the title, and centring the boxes leaves the two texts visibly unaligned.
 */
export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </h1>
      {children && (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>
          {children}
        </div>
      )}
    </div>
  )
}
