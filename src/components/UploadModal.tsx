import { Download, FileSpreadsheet, Globe, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ParseResult } from '../types'
import { fetchBpnResults, probeBpnRanks, type BpnPull, type BpnStatus } from '../lib/bpnRanks'
import { parseBpnRows } from '../lib/bpnRows'
import { withSnapshotDate } from '../lib/parser'
import { SITES, siteById } from '../lib/sites'

interface UploadModalProps {
  /** The property being viewed — almost always the one being uploaded for. */
  defaultSiteId: string
  /**
   * Resolves the caller's Supabase access token for the ranking-API endpoint's own
   * server-side authorization. Asked for per pull rather than held, so a modal left
   * open never sends a token that expired while it sat there.
   */
  getAccessToken: () => Promise<string | null>
  onClose: () => void
  onConfirm: (result: ParseResult) => void
}

/** Which source filled the review panel. Both end in the same `ParseResult`. */
type ImportSource = 'file' | 'api'

/**
 * Parse-and-review before anything is committed.
 *
 * TWO SOURCES, ONE REVIEW PANEL. A spreadsheet and a ranking-API pull both produce a
 * `ParseResult` from the same `parseRows`, so they share this dialog's summary, its
 * editable snapshot date, its duplicate-date warning and its confirm. That is the
 * whole reason the API pull lives here rather than behind its own refresh button:
 * a separate dialog would be the only write path in the app with no preview, and the
 * two paths could drift into disagreeing about totals or dates.
 *
 * Parse errors render INSIDE the modal rather than as a toast: the modal is still
 * open, and a notification that disappears behind it is a notification the user never
 * reads.
 */
export function UploadModal({
  defaultSiteId,
  getAccessToken,
  onClose,
  onConfirm,
}: UploadModalProps) {
  const [siteId, setSiteId] = useState(defaultSiteId)
  const [source, setSource] = useState<ImportSource>('file')
  const [domain, setDomain] = useState(() => siteById(defaultSiteId).domain)
  const [apiStatus, setApiStatus] = useState<BpnStatus>({ state: 'connecting' })
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [pull, setPull] = useState<BpnPull | null>(null)
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

  /**
   * Probes the ranking-API endpoint once per open. Costs nothing at the vendor — it
   * only reports whether a key is configured — and it is what lets the API tab
   * explain itself instead of failing after a click.
   *
   * Both halves of the abort handling are load-bearing (invariant 33). `probeBpnRanks`
   * RETHROWS a cancellation, and the `signal.aborted` re-check here is what stops a
   * dead probe from setting state: StrictMode mounts this twice, so the cleanup always
   * cancels the first probe mid-flight, and letting that resolve to `offline` puts it
   * in a race with the live one — a good key reading "unavailable" on every other
   * open. The `.catch` is equally required: without it the rethrow becomes an
   * unhandled rejection on every mount.
   */
  useEffect(() => {
    const controller = new AbortController()
    probeBpnRanks(controller.signal)
      .then((status) => {
        if (!controller.signal.aborted) setApiStatus(status)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  /** Anything parsed belongs to the source and site it came from. */
  function resetReview() {
    setParsed(null)
    setPull(null)
    setError(null)
    setDateOverride('')
  }

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
      setPull(null)
      setDateOverride(result.detectedDate)
    } catch (err) {
      setParsed(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handlePull() {
    setError(null)
    setBusy(true)
    try {
      const token = await getAccessToken()
      const pulled = await fetchBpnResults({ domain, token: token ?? undefined })
      // Straight into the SAME parser a spreadsheet goes through, which is what
      // makes an API pull and a file import incapable of disagreeing about dedupe,
      // market ordering, unmatched keywords, dates or grouping.
      const result = parseBpnRows(pulled.rows, domain.trim(), siteId)
      setParsed(result)
      setPull(pulled)
      setDateOverride(result.detectedDate)
    } catch (err) {
      setParsed(null)
      setPull(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function confirm() {
    if (!parsed) return
    // Re-stamp only when the user actually changed it. withSnapshotDate also changes
    // the id, which is what stops an overridden date from overwriting a different
    // day's snapshot.
    onConfirm(
      dateOverride && dateOverride !== parsed.detectedDate
        ? withSnapshotDate(parsed, dateOverride)
        : parsed,
    )
  }

  const sourceTab = (value: ImportSource, label: string, Icon: typeof Upload) => {
    const selected = source === value
    return (
      <button
        key={value}
        type="button"
        onClick={() => {
          if (selected) return
          setSource(value)
          // A review panel filled from the other source is stale the moment the
          // source changes — its date, its counts and its provenance all belong to
          // the pull or the file that produced it.
          resetReview()
        }}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] transition-colors"
        style={{
          border: `1px solid ${selected ? 'var(--brand-blue)' : 'var(--border)'}`,
          background: selected ? 'var(--active-tint)' : 'transparent',
          color: selected ? 'var(--ink)' : 'var(--text-2)',
          fontWeight: selected ? 600 : 400,
        }}
        aria-pressed={selected}
      >
        <Icon size={13} className="shrink-0" />
        <span>{label}</span>
      </button>
    )
  }

  /** Set only when the parser collapsed rows the panel counted separately. */
  const collapsedRows =
    pull && parsed ? pull.rowCount - parsed.snapshot.records.length : 0

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
              {source === 'file'
                ? 'An .xlsx, .xls or .csv export with a Keyword column'
                : 'A live pull from the ranking panel'}
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
                    // A file parsed for the other property is stale: its snapshot
                    // already carries the old site id, so importing it now would
                    // file the data under the wrong property with nothing on
                    // screen to reveal it.
                    resetReview()
                    // The domain follows the property, since that is what a pull is
                    // almost always for. Still editable — our own domain is not in
                    // the panel yet, so being able to point it elsewhere is the only
                    // way to exercise this at all.
                    setDomain(site.domain)
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

        <div className="pb-4">
          <div
            className="pb-1.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: 'var(--muted)' }}
          >
            Source
          </div>
          <div className="flex gap-2">
            {sourceTab('file', 'Spreadsheet', FileSpreadsheet)}
            {sourceTab('api', 'Ranking API', Globe)}
          </div>
        </div>

        {!parsed && source === 'file' && (
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

        {!parsed && source === 'api' && (
          <div
            className="flex flex-col gap-2.5 rounded-xl px-4 py-4"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border-3)' }}
          >
            {/* The offline reason is RENDERED rather than the tab being disabled. A
                control that cannot be used and does not say why is the same mistake
                as a control whose only label lives somewhere the layout dropped. */}
            {apiStatus.state === 'offline' ? (
              <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
                {apiStatus.reason}
              </p>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span
                    className="text-[9px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: 'var(--muted)' }}
                  >
                    Domain
                  </span>
                  <input
                    type="text"
                    value={domain}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="example.com"
                    onChange={(e) => setDomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy && domain.trim() !== '') void handlePull()
                    }}
                    className="rounded-lg px-2.5 py-1.5 font-mono text-[12px] outline-none"
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--ink)',
                    }}
                  />
                  <span className="text-[10px]" style={{ color: 'var(--muted-3)' }}>
                    Whichever domain the panel tracks. Defaults to the selected
                    property, which the panel may not hold — a pull that finds nothing
                    imports nothing and says so.
                  </span>
                </label>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy || apiStatus.state !== 'ready' || domain.trim() === ''}
                    onClick={() => void handlePull()}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                    style={{ background: 'var(--btn-ink)' }}
                  >
                    <Download size={13} />
                    {busy
                      ? 'Pulling…'
                      : apiStatus.state === 'connecting'
                        ? 'Checking…'
                        : 'Fetch rankings'}
                  </button>
                </div>
              </>
            )}
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
              {pull ? (
                <Globe size={16} style={{ color: 'var(--brand-blue)' }} />
              ) : (
                <FileSpreadsheet size={16} style={{ color: 'var(--brand-blue)' }} />
              )}
              <div className="text-[12px]" style={{ color: 'var(--ink)' }}>
                <strong>{parsed.snapshot.records.length.toLocaleString()}</strong> records ·{' '}
                <strong>{parsed.markets.length}</strong> market
                {parsed.markets.length === 1 ? '' : 's'} ({parsed.markets.join(', ')})
                {pull && (
                  <>
                    {' · '}
                    <span style={{ color: 'var(--muted)' }}>
                      {pull.rowCount.toLocaleString()} row{pull.rowCount === 1 ? '' : 's'} over{' '}
                      {pull.pages} page{pull.pages === 1 ? '' : 's'}
                    </span>
                  </>
                )}
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
                {pull
                  ? 'The most frequent check date in the pull. The panel re-checks on its own schedule, so one pull can span several days — correct it if this is not the week you mean.'
                  : 'Detected from the file. Correct it if the export carried no date — a mislabelled snapshot breaks every movement calculation.'}
              </span>
            </label>

            {/* A truncated pull is otherwise indistinguishable from a complete one,
                and it would be committed as if it were the whole week. */}
            {pull?.truncated && (
              <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                The pull hit its page ceiling, so rows are missing. Import this only if
                a partial week is what you want.
              </p>
            )}
            {collapsedRows > 0 && (
              <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                {collapsedRows} row{collapsedRows === 1 ? '' : 's'} shared a keyword and
                market with another and were collapsed — the panel may be tracking one
                keyword in more than one language.
              </p>
            )}
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
                onClick={resetReview}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
                style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                {pull ? 'Pull again' : 'Choose another'}
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
