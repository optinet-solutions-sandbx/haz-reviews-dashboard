import type { ParsedPosition, RankingRecord } from '../types'
import { effectiveDelta, parsePosition } from '../lib/normalize'

interface PosBadgeProps {
  record: RankingRecord
  /**
   * undefined → there is no previous snapshot at all; fall back to the record's
   *             own in-file change token.
   * null      → a previous snapshot exists but this key was absent from it.
   *             Render with NO colour: absence of data is not a movement.
   */
  crossSnapPrevPos?: ParsedPosition
}

/**
 * Position plus movement.
 *
 * Cross-snapshot comparison beats trusting the export's own change column: a
 * rank that genuinely did not move renders plain regardless of what the
 * spreadsheet claimed, and a keyword that simply was not measured last week does
 * not masquerade as a new entry.
 */
export function PosBadge({ record, crossSnapPrevPos }: PosBadgeProps) {
  const pos = parsePosition(record.position)

  if (pos === null) {
    return (
      <span className="font-mono text-[11px]" style={{ color: 'var(--muted-3)' }}>
        —
      </span>
    )
  }

  if (pos === 'NR') {
    return (
      <span className="font-mono text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
        NR
      </span>
    )
  }

  // No previous snapshot: the file's own change token is all we have.
  if (crossSnapPrevPos === undefined) {
    const d = effectiveDelta(record.change, pos)
    const color = d > 0 ? 'var(--mx-pos)' : d < 0 ? 'var(--mx-neg)' : 'var(--mx-ink)'
    return (
      <span className="font-mono text-[11px] font-medium" style={{ color }}>
        {pos}
        {d !== 0 && (
          <span className="ml-1 text-[10px]">
            {d > 0 ? '▲' : '▼'}
            {Math.abs(d) > 1 ? ` ${Math.abs(d)}` : ''}
          </span>
        )}
      </span>
    )
  }

  // Measured before, but this keyword/market was not in that snapshot.
  if (crossSnapPrevPos === null) {
    return (
      <span className="font-mono text-[11px] font-medium" style={{ color: 'var(--mx-ink)' }}>
        {pos}
        <span className="ml-1 text-[9px]" style={{ color: 'var(--muted-3)' }}>
          new
        </span>
      </span>
    )
  }

  // Entered the rankings from NR.
  if (crossSnapPrevPos === 'NR') {
    return (
      <span className="font-mono text-[11px] font-medium" style={{ color: 'var(--mx-pos)' }}>
        {pos}
        <span className="ml-1 text-[10px]">▲ NR</span>
      </span>
    )
  }

  const prev = crossSnapPrevPos
  // Lower is better, so a larger previous number means it improved.
  const improved = prev > pos
  const dropped = prev < pos
  const color = improved ? 'var(--mx-pos)' : dropped ? 'var(--mx-neg)' : 'var(--mx-ink)'

  return (
    <span className="font-mono text-[11px] font-medium" style={{ color }}>
      {pos}
      {(improved || dropped) && (
        <span className="ml-1 text-[10px]">
          {improved ? '▲' : '▼'} ({prev})
        </span>
      )}
    </span>
  )
}
