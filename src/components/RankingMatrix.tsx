import { useMemo } from 'react'
import type { ParsedPosition, RankingRecord, Snapshot } from '../types'
import { parsePosition } from '../lib/normalize'
import { EditableCell } from './EditableCell'
import { PosBadge } from './PosBadge'

/** Column palette pairs, cycled per market. The reserved purple pair goes to the
 *  first market so the primary column is visually distinct. */
const PALETTE = ['purple', 'blue', 'green', 'orange', 'cyan', 'yellow', 'magenta', 'grey'] as const

function recordKey(keyword: string, market: string): string {
  return `${keyword.toLowerCase()}|${market.toLowerCase()}`
}

interface RankingMatrixProps {
  snapshot: Snapshot
  /** undefined when this is the oldest loaded snapshot — PosBadge then falls back
   *  to each record's own change token. */
  previousSnapshot: Snapshot | undefined
  markets: string[]
  records: RankingRecord[]
  editDisabled: boolean
  editTitle?: string
  onEditVolume: (record: RankingRecord, next: string) => Promise<void>
}

/**
 * One snapshot rendered as a spreadsheet-fidelity table.
 *
 * The keyword column is sticky and its background must stay fully opaque — it
 * overlays scrolled content, and any alpha would let rows show through as they
 * pass underneath.
 */
export function RankingMatrix({
  snapshot,
  previousSnapshot,
  markets,
  records,
  editDisabled,
  editTitle,
  onEditVolume,
}: RankingMatrixProps) {
  // Built once per render rather than per cell. null (not an empty map) encodes
  // "there is no previous snapshot", which PosBadge treats differently from
  // "this key was absent from the previous snapshot".
  const prevByKey = useMemo(() => {
    if (!previousSnapshot) return null
    const m = new Map<string, ParsedPosition>()
    for (const r of previousSnapshot.records) {
      m.set(recordKey(r.keyword, r.market), parsePosition(r.position))
    }
    return m
  }, [previousSnapshot])

  // One row per keyword, with each market as a column.
  const rows = useMemo(() => {
    const byKeyword = new Map<string, Map<string, RankingRecord>>()
    for (const r of records) {
      const existing = byKeyword.get(r.keyword) ?? new Map<string, RankingRecord>()
      existing.set(r.market, r)
      byKeyword.set(r.keyword, existing)
    }
    return Array.from(byKeyword.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [records])

  if (rows.length === 0) {
    return (
      <div
        className="rounded-lg py-8 text-center font-mono text-[11px]"
        style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', color: 'var(--muted)' }}
      >
        No keywords match the current filters.
      </div>
    )
  }

  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ border: '1px solid var(--border-2)', background: 'var(--mx-bg)' }}
    >
      {/* Date band. Theme-independent by design — it stays light in dark mode. */}
      <div
        className="px-3 py-1.5 font-mono text-[11px] font-medium text-white"
        style={{ background: 'var(--band-date)' }}
      >
        {snapshot.displayDate}
        <span className="pl-2 opacity-70">
          {rows.length.toLocaleString()} keyword{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Wide content scrolls inside its own container so the page body never
          scrolls horizontally. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr style={{ background: 'var(--mx-head)' }}>
              <th
                className="sticky left-0 z-10 px-3 py-2 text-left font-semibold"
                style={{
                  // Opaque: this header cell overlays scrolled columns.
                  background: 'var(--mx-head)',
                  color: 'var(--mx-head-ink)',
                  borderBottom: '1px solid var(--mx-line)',
                  minWidth: 240,
                }}
              >
                Keyword
              </th>
              {markets.map((market, i) => {
                const hue = PALETTE[i % PALETTE.length]
                return (
                  <th
                    key={market}
                    className="px-2 py-2 text-center font-semibold"
                    style={{
                      background: `var(--mx-col-${hue}-h)`,
                      color: 'var(--mx-head-ink)',
                      borderBottom: '1px solid var(--mx-line)',
                      borderLeft: '1px solid var(--mx-line-2)',
                      minWidth: 90,
                    }}
                  >
                    {market}
                  </th>
                )
              })}
              <th
                className="px-2 py-2 text-left font-semibold"
                style={{
                  color: 'var(--mx-head-ink)',
                  borderBottom: '1px solid var(--mx-line)',
                  borderLeft: '1px solid var(--mx-line-2)',
                  minWidth: 90,
                }}
              >
                Volume
              </th>
              <th
                className="px-2 py-2 text-left font-semibold"
                style={{
                  color: 'var(--mx-head-ink)',
                  borderBottom: '1px solid var(--mx-line)',
                  borderLeft: '1px solid var(--mx-line-2)',
                  minWidth: 160,
                }}
              >
                Ranking URL
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([keyword, byMarket], rowIndex) => {
              const odd = rowIndex % 2 === 1
              const rowBg = odd ? 'var(--mx-alt)' : 'var(--mx-bg)'
              const stickyBg = odd ? 'var(--mx-sticky-alt)' : 'var(--mx-sticky)'
              // Volume and URL are per keyword, so read them from any market row.
              const anyRecord = markets.map((m) => byMarket.get(m)).find(Boolean)

              return (
                <tr key={keyword}>
                  <td
                    className="sticky left-0 z-10 px-3 py-1.5"
                    style={{
                      background: stickyBg,
                      color: 'var(--mx-ink)',
                      borderBottom: '1px solid var(--mx-line-2)',
                    }}
                    title={keyword}
                  >
                    <span className="block max-w-[320px] truncate">{keyword}</span>
                  </td>

                  {markets.map((market, i) => {
                    const record = byMarket.get(market)
                    const hue = PALETTE[i % PALETTE.length]
                    return (
                      <td
                        key={market}
                        className="px-2 py-1.5 text-center"
                        style={{
                          background: `var(--mx-col-${hue}-c)`,
                          borderBottom: '1px solid var(--mx-line-2)',
                          borderLeft: '1px solid var(--mx-line-2)',
                        }}
                      >
                        {record ? (
                          <PosBadge
                            record={record}
                            crossSnapPrevPos={
                              prevByKey === null
                                ? undefined
                                : (prevByKey.get(recordKey(keyword, market)) ?? null)
                            }
                          />
                        ) : (
                          <span style={{ color: 'var(--muted-3)' }}>—</span>
                        )}
                      </td>
                    )
                  })}

                  <td
                    className="px-1 py-1"
                    style={{
                      background: rowBg,
                      borderBottom: '1px solid var(--mx-line-2)',
                      borderLeft: '1px solid var(--mx-line-2)',
                    }}
                  >
                    {anyRecord && (
                      <EditableCell
                        value={anyRecord.searchVolume}
                        disabled={editDisabled}
                        title={editDisabled ? editTitle : 'Click to edit search volume'}
                        onSave={(next) => onEditVolume(anyRecord, next)}
                      />
                    )}
                  </td>

                  <td
                    className="px-2 py-1.5"
                    style={{
                      background: rowBg,
                      borderBottom: '1px solid var(--mx-line-2)',
                      borderLeft: '1px solid var(--mx-line-2)',
                    }}
                  >
                    {anyRecord?.urlFound ? (
                      <a
                        href={anyRecord.urlFound}
                        target="_blank"
                        rel="noreferrer"
                        title={anyRecord.urlFound}
                        className="block max-w-[220px] truncate font-mono text-[10px] hover:underline"
                        style={{ color: 'var(--info)' }}
                      >
                        {anyRecord.urlFound.replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    ) : (
                      <span className="font-mono text-[10px]" style={{ color: 'var(--muted-3)' }}>
                        —
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
