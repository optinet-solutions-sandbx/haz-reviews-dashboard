import { CheckCircle2, X } from 'lucide-react'
import { useEffect } from 'react'
import type { ParseResult } from '../types'
import { groupForKeyword } from '../lib/groups'

const UNMATCHED_PREVIEW = 20

interface UploadSummaryProps {
  result: ParseResult
  onClose: () => void
}

/** Post-import breakdown. The unmatched-keyword list is the actionable output:
 *  it tells the user exactly which groups to add to the registry. */
export function UploadSummary({ result, onClose }: UploadSummaryProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const groupCounts = new Map<string, number>()
  for (const r of result.snapshot.records) {
    const name = groupForKeyword(r.keyword).name
    groupCounts.set(name, (groupCounts.get(name) ?? 0) + 1)
  }
  const sorted = Array.from(groupCounts.entries()).sort((a, b) => b[1] - a[1])

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="animate-modal-in flex max-h-[85vh] w-[480px] max-w-[95vw] flex-col rounded-2xl p-5"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.12)',
        }}
      >
        <div className="flex items-start justify-between pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} style={{ color: 'var(--pos)' }} />
            <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
              Import complete
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'var(--muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 pb-4">
          <Stat label="Records" value={result.snapshot.records.length} />
          <Stat label="Groups" value={sorted.length} />
          <Stat label="Markets" value={result.markets.length} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <SectionLabel>Snapshot</SectionLabel>
          <p className="pb-3 font-mono text-[12px]" style={{ color: 'var(--ink)' }}>
            {result.snapshot.displayDate}
          </p>

          <SectionLabel>By group</SectionLabel>
          <div className="flex flex-col gap-1 pb-3">
            {sorted.map(([name, count]) => (
              <div key={name} className="flex items-center justify-between text-[12px]">
                <span style={{ color: 'var(--text-2)' }}>{name}</span>
                <span className="font-mono" style={{ color: 'var(--ink)' }}>
                  {count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          {result.unknownMarkets.length > 0 && (
            <>
              <SectionLabel>Unlisted markets</SectionLabel>
              <p className="pb-3 text-[11px]" style={{ color: 'var(--warn)' }}>
                {result.unknownMarkets.join(', ')} — imported and shown, but not in{' '}
                <code>MARKET_ORDER</code>. Add them to <code>src/lib/groups.ts</code> to control
                column order.
              </p>
            </>
          )}

          {result.unmatchedKeywords.length > 0 && (
            <>
              <SectionLabel>Unmatched keywords ({result.unmatchedKeywords.length})</SectionLabel>
              <p className="pb-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
                Imported under <strong>Other</strong>. Add a group or alias in{' '}
                <code>src/lib/groups.ts</code> and they will re-group automatically — including in
                past snapshots.
              </p>
              <ul className="pb-2">
                {result.unmatchedKeywords.slice(0, UNMATCHED_PREVIEW).map((k) => (
                  <li key={k} className="truncate font-mono text-[10px]" style={{ color: 'var(--text-2)' }}>
                    {k}
                  </li>
                ))}
              </ul>
              {result.unmatchedKeywords.length > UNMATCHED_PREVIEW && (
                <p className="text-[10px]" style={{ color: 'var(--muted-3)' }}>
                  …and {result.unmatchedKeywords.length - UNMATCHED_PREVIEW} more
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-1.5 text-[12px] font-semibold text-white"
            style={{ background: 'var(--btn-ink)' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-[10px] px-3 py-2.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border-3)' }}
    >
      <div className="font-display text-[20px] font-semibold leading-none" style={{ color: 'var(--ink)' }}>
        {value.toLocaleString()}
      </div>
      <div
        className="pt-1 text-[9px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pb-1 text-[9px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: 'var(--muted-3)' }}
    >
      {children}
    </div>
  )
}
