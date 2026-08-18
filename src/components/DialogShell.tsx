import { useEffect, useId, useRef } from 'react'

/**
 * Native <dialog> mechanics. Escape, the focus trap and inertness of the page
 * behind come from the platform, so none of it is reimplemented here.
 *
 * Two rules are load-bearing:
 *
 * 1. `m-auto` is required. Tailwind's preflight sets `margin: 0` on every
 *    element, which kills the UA stylesheet's `margin: auto` that centres a
 *    modal dialog. Do NOT reach for a flex overlay instead — that costs all the
 *    platform behaviours above.
 * 2. Closing goes through `dialog.close()`, never by calling `onClose` directly.
 *    Escape, the backdrop and the close button then all converge on one native
 *    `close` event, so `onClose` fires exactly once however it was dismissed.
 */
export function DialogShell({
  open,
  title,
  caption,
  onClose,
  children,
}: {
  open: boolean
  title: string
  caption?: string
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onClose={onClose}
      // Clicking the backdrop lands on the dialog element itself, never on its
      // content, so this closes on a backdrop click without swallowing clicks
      // inside the panel.
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close()
      }}
      className="animate-modal-in m-auto w-[min(56rem,92vw)] rounded-2xl p-0 backdrop:bg-black/40"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-modal)',
        color: 'var(--ink)',
      }}
    >
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid var(--border-3)' }}
      >
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            className="text-[13px] font-semibold leading-none"
            style={{ color: 'var(--navy-text)' }}
          >
            {title}
          </h2>
          {caption && (
            <p className="mt-0.5 text-[10px]" style={{ color: 'var(--muted)' }}>
              {caption}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
          title="Close"
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-[18px] leading-none transition-colors"
          style={{ color: 'var(--muted)' }}
        >
          ×
        </button>
      </div>
      <div className="max-h-[70vh] overflow-auto px-5 py-3">{children}</div>
    </dialog>
  )
}
