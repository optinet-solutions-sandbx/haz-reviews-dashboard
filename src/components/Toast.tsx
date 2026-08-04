import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react'
import type { ToastItem } from '../types'

const ICONS = { success: CheckCircle2, warning: AlertTriangle, error: XCircle } as const
const ACCENTS = { success: '--pos', warning: '--warn', error: '--neg' } as const

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.type]
        return (
          <div
            key={t.id}
            className="animate-toast-in flex max-w-[380px] items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
            style={{
              background: 'var(--surface)',
              borderColor: `var(${ACCENTS[t.type]}-border)`,
              color: 'var(--ink)',
            }}
          >
            <Icon
              size={15}
              style={{ color: `var(${ACCENTS[t.type]})`, marginTop: 1, flexShrink: 0 }}
            />
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 opacity-50 transition-opacity hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
