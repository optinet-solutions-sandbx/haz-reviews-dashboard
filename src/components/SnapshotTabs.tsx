import type { SnapshotMeta } from '../types'

interface SnapshotTabsProps {
  snapshots: SnapshotMeta[]
  activeId: string | null
  onSelect: (id: string) => void
}

/** Horizontal date tabs. The newest carries a LATEST pill so "no selection"
 *  still reads as a deliberate state rather than an empty one. */
export function SnapshotTabs({ snapshots, activeId, onSelect }: SnapshotTabsProps) {
  if (snapshots.length === 0) return null
  const effectiveId = activeId ?? snapshots[0]?.id

  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {snapshots.map((s, i) => {
        const active = s.id === effectiveId
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[11px] transition-colors"
            style={{
              background: active ? 'var(--active-tint)' : 'var(--surface)',
              border: `1px solid ${active ? 'var(--brand-blue)' : 'var(--border-2)'}`,
              color: active ? 'var(--navy-text)' : 'var(--text-2)',
            }}
          >
            {s.displayDate}
            {i === 0 && (
              <span
                className="rounded px-1 py-px text-[8px] font-semibold uppercase tracking-[0.1em] text-white"
                style={{ background: 'var(--brand-blue)' }}
              >
                Latest
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
