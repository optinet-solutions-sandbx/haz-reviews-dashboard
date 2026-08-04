import { AlertTriangle } from 'lucide-react'

/**
 * Shown when the snapshot load FAILED, in place of the empty state.
 *
 * The distinction matters: "no data yet" and "we could not reach the database"
 * look identical on screen but mean opposite things, and the first one invites the
 * user to import data they may already have.
 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="animate-fade-up rounded-xl px-6 py-10 text-center"
      style={{ background: 'var(--surface)', border: '1px solid var(--neg-border)' }}
    >
      <AlertTriangle size={20} style={{ color: 'var(--neg)', margin: '0 auto' }} />
      <h2
        className="pt-2 font-display text-[17px] font-semibold"
        style={{ color: 'var(--ink)' }}
      >
        Could not load ranking data
      </h2>
      <p
        className="mx-auto max-w-[460px] pt-2 font-mono text-[11px] leading-relaxed"
        style={{ color: 'var(--neg)' }}
      >
        {message}
      </p>
      <p
        className="mx-auto max-w-[460px] pt-2 text-[12px] leading-relaxed"
        style={{ color: 'var(--text-2)' }}
      >
        This is a connection or permissions problem, not an empty dataset — your existing
        snapshots are untouched.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white"
        style={{ background: 'var(--btn-ink)' }}
      >
        Try again
      </button>
    </div>
  )
}
