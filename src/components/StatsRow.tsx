import type { StatsCounts } from '../types'

export type StatKey = 'top3' | 'improved' | 'dropped' | 'unchanged' | 'notRanking'

const CARDS: Array<{ key: StatKey; label: string; accent: string }> = [
  { key: 'top3', label: 'Top 3', accent: 'var(--info)' },
  { key: 'improved', label: 'Improved', accent: 'var(--pos)' },
  { key: 'dropped', label: 'Dropped', accent: 'var(--neg)' },
  { key: 'unchanged', label: 'Unchanged', accent: 'var(--muted)' },
  { key: 'notRanking', label: 'Not ranking', accent: 'var(--warn)' },
]

interface StatsRowProps {
  stats: StatsCounts
  active: StatKey | null
  onToggle: (key: StatKey) => void
}

/**
 * Five toggle FILTERS, not static readouts. Clicking one scopes the matrix.
 *
 * The cards deliberately do not sum to the total: Top 3 overlaps the movement
 * buckets, because a top-3 keyword that moved up should read green AND count in
 * Top 3. /how-it-works explains that to users.
 */
export function StatsRow({ stats, active, onToggle }: StatsRowProps) {
  return (
    <div className="grid grid-cols-3 gap-[5px] sm:grid-cols-5">
      {CARDS.map(({ key, label, accent }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className="relative overflow-hidden rounded-[10px] px-3 pb-2.5 pt-3 text-left transition-all"
            style={{
              background: isActive
                ? // color-mix with a variable is required: concatenating a hex
                  // with an alpha suffix breaks when accent is a CSS variable.
                  `color-mix(in srgb, ${accent} 7%, transparent)`
                : 'var(--surface)',
              border: isActive ? `2px solid ${accent}` : '1px solid var(--border-2)',
              boxShadow: isActive ? `0 0 0 3px color-mix(in srgb, ${accent} 18%, transparent)` : 'none',
            }}
          >
            <span
              className="absolute inset-x-0 top-0 h-[2px]"
              style={{ background: accent }}
              aria-hidden
            />
            <div
              className="font-display text-[22px] font-semibold leading-none sm:text-[26px]"
              style={{ color: 'var(--ink)' }}
            >
              {stats[key].toLocaleString()}
            </div>
            <div
              className="pt-1.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: 'var(--muted)' }}
            >
              {label}
            </div>
            <div
              className="text-[9px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: isActive ? accent : 'transparent' }}
            >
              ▸ filtering
            </div>
          </button>
        )
      })}
    </div>
  )
}
