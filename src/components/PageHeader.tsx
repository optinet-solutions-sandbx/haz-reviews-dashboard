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
export function PageHeader({
  title,
  children,
  action,
}: {
  title: string
  children?: React.ReactNode
  /**
   * A trailing control — the Rankings page's Import button today. Kept a slot
   * rather than a boolean prop so this component never has to know what the
   * action is or who is allowed to use it.
   */
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </h1>
      {(children || action) && (
        // `items-center` inside, deliberately against the outer baseline: a button
        // has a border and padding, so baseline-aligning it against the caption
        // text hangs it below the line.
        <div className="flex items-center gap-3">
          {children && (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              {children}
            </div>
          )}
          {action}
        </div>
      )}
    </div>
  )
}
