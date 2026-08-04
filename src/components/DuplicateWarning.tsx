import { AlertTriangle } from 'lucide-react'
import { useEffect } from 'react'

interface DuplicateWarningProps {
  displayDate: string
  incomingCount: number
  existingCount: number | null
  onReplace: () => void
  onCancel: () => void
}

/** A snapshot already exists for this date. Replacing is safe because upsert is
 *  wipe-and-replace, but it is destructive enough to confirm. */
export function DuplicateWarning({
  displayDate,
  incomingCount,
  existingCount,
  onReplace,
  onCancel,
}: DuplicateWarningProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="animate-modal-in w-[420px] max-w-[95vw] rounded-2xl p-5"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.12)',
        }}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={18} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <h2 className="font-display text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
              A snapshot already exists for {displayDate}
            </h2>
            <p className="pt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Replacing it removes the{' '}
              {existingCount === null ? 'stored' : existingCount.toLocaleString()} existing record
              {existingCount === 1 ? '' : 's'} for that date and writes{' '}
              {incomingCount.toLocaleString()} in their place. Any manual search-volume edits on
              that snapshot will be lost.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onReplace}
            className="rounded-lg px-3.5 py-1.5 text-[12px] font-semibold text-white"
            style={{ background: 'var(--neg)' }}
          >
            Replace
          </button>
        </div>
      </div>
    </div>
  )
}
