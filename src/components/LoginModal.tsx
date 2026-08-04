import { X } from 'lucide-react'
import { useEffect } from 'react'
import { LoginForm } from './LoginForm'

/**
 * Inline sign-in, opened by requireAuth when an action needs a session.
 *
 * Closing it must call cancelAuth, not just hide the modal: the pending action is
 * holding a promise that has to settle.
 */
export function LoginModal({ onCancel }: { onCancel: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        className="animate-modal-in w-[420px] max-w-[95vw] rounded-2xl p-5"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.12)',
        }}
      >
        <div className="flex justify-end">
          <button type="button" onClick={onCancel} aria-label="Close" style={{ color: 'var(--muted)' }}>
            <X size={16} />
          </button>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
