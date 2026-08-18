import { FileSpreadsheet, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ParseResult } from '../types'
import { withSnapshotDate } from '../lib/parser'
import { SITES } from '../lib/sites'

interface UploadModalProps {
  /** The property being viewed — almost always the one being uploaded for. */
  defaultSiteId: string
  onClose: () => void
  onConfirm: (result: ParseResult) => void
}

/**
 * Parse-and-review before anything is committed.
 *
 * Parse errors render INSIDE the modal rather than as a toast: the modal is still
 * open, and a notification that disappears behind it is a notification the user
 * never reads.
 */
export function UploadModal({ defaultSiteId, onClose, onConfirm }: UploadModalProps) {
  const [siteId, setSiteId] = useState(defaultSiteId)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [dateOverride, setDateOverride] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      // Dynamic import: the xlsx parser is ~600 kB and nobody who never imports a
      // file should have to download it.
      const [{ parseSheet }, buffer] = await Promise.all([
        import('../lib/readWorkbook'),
        file.arrayBuffer(),
      ])
      const result = parseSheet(buffer, siteId)
      setParsed(result)
      setDateOverride(result.detectedDate)
    } catch (err) {
      setParsed(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function confirm() {
    if (!parsed) return
    // Re-stamp only when the user actually changed it. withSnapshotDate also
    // changes the id, which is what stops an overridden date from overwriting a
    // different day's snapshot.
    onConfirm(
      dateOverride && dateOverride !== parsed.detectedDate
        ? withSnapshotDate(parsed, dateOverride)
        : parsed,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="animate-modal-in w-[520px] max-w-[95vw] rounded-2xl p-5"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.12)',
        }}
      >
        <div className="flex items-start justify-between pb-4">
          <div>
            <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
              Import ranking data
            </h2>
            <p className="pt-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
              An .xlsx, .xls or .csv export with a Keyword column
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'var(--muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Chosen before a file is picked, because the target determines the
            snapshot id the parse produces. */}
        <div className="pb-4">
          <div
            className="pb-1.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: 'var(--muted)' }}
          >
            Import into
          </div>
          {/* Two columns, not one flex row. `flex-1` across six properties leaves
              each chip about 70px wide inside a 520px dialog — narrower than the
              dot and padding alone — so every label truncated to one letter. */}
          <div className="grid grid-cols-2 gap-2">
            {SITES.map((site) => {
              const selected = site.id === siteId
              return (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => {
                    if (selected) return
                    setSiteId(site.id)
                    // A file parsed for the other property is stale: its
                    // snapshot already carries the old site id, so importing it
                    // now would file the data under the wrong property with
                    // nothing on screen to reveal it.
                    setParsed(null)
                    setError(null)
                    setDateOverride('')
                  }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition-colors"
                  style={{
                    border: `1px solid ${selected ? site.color : 'var(--border)'}`,
                    background: selected ? 'var(--active-tint)' : 'transparent',
                    color: selected ? 'var(--ink)' : 'var(--text-2)',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: site.color }}
                    aria-hidden
                  />
                  <span className="truncate">{site.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {!parsed && (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files[0]
              if (file) void handleFile(file)
            }}
            className="flex flex-col items-center justify-center rounded-xl px-4 py-10 text-center"
            style={{
              border: `1.5px dashed ${dragging ? 'var(--brand-blue)' : 'var(--border-strong)'}`,
              background: dragging ? 'var(--active-tint)' : 'var(--surface-2)',
            }}
          >
            <Upload size={22} style={{ color: 'var(--muted)' }} />
            <p className="pt-2.5 text-[13px]" style={{ color: 'var(--text-2)' }}>
              {busy ? 'Reading the file…' : 'Drop the export here'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="mt-2.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--btn-ink)' }}
            >
              Choose a file
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </div>
        )}

        {error && (
          <div
            className="rounded-lg px-3 py-2.5 text-[12px]"
            style={{
              background: 'var(--neg-surface)',
              border: '1px solid var(--neg-border)',
              color: 'var(--neg)',
            }}
          >
            {error}
          </div>
        )}

        {parsed && (
          <div className="flex flex-col gap-3">
            <div
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-3)' }}
            >
              <FileSpreadsheet size={16} style={{ color: 'var(--brand-blue)' }} />
              <div className="text-[12px]" style={{ color: 'var(--ink)' }}>
                <strong>{parsed.snapshot.records.length.toLocaleString()}</strong> records ·{' '}
                <strong>{parsed.markets.length}</strong> market
                {parsed.markets.length === 1 ? '' : 's'} ({parsed.markets.join(', ')})
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span
                className="text-[9px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: 'var(--muted)' }}
              >
                Snapshot date
              </span>
              <input
                type="date"
                value={dateOverride}
                onChange={(e) => setDateOverride(e.target.value)}
                className="rounded-lg px-2.5 py-1.5 font-mono text-[12px] outline-none"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink)',
                }}
              />
              <span className="text-[10px]" style={{ color: 'var(--muted-3)' }}>
                Detected from the file. Correct it if the export carried no date —
                a mislabelled snapshot breaks every movement calculation.
              </span>
            </label>

            {parsed.skippedRows > 0 && (
              <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                {parsed.skippedRows} row{parsed.skippedRows === 1 ? '' : 's'} skipped — no keyword.
              </p>
            )}
            {parsed.unmatchedKeywords.length > 0 && (
              <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                {parsed.unmatchedKeywords.length} keyword
                {parsed.unmatchedKeywords.length === 1 ? '' : 's'} did not match a group — they will
                be imported under <strong>Other</strong>.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setParsed(null)
                  setError(null)
                }}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                Choose another
              </button>
              <button
                type="button"
                onClick={confirm}
                className="rounded-lg px-3.5 py-1.5 text-[12px] font-semibold text-white"
                style={{ background: 'var(--btn-ink)' }}
              >
                Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
