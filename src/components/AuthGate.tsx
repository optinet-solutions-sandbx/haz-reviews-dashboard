import type { ReactNode } from 'react'
import { REQUIRE_AUTH } from '../lib/auth'
import { signOut } from '../lib/auth'
import { useAuth } from '../lib/useAuth'
import { LoginForm } from './LoginForm'

/**
 * Whole-app session + approval gate. Active only when VITE_REQUIRE_AUTH is true.
 *
 * States: checking session → sign in → checking access → pending | revoked |
 * approved.
 *
 * `pending` and `revoked` get deliberately different copy. Telling someone whose
 * access was withdrawn that they are "awaiting approval" invites them to wait for
 * something that is never coming.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // This is a second useAuth instance (Layout owns the other). Each keeps its own
  // subscription, which costs one extra approval lookup on load and keeps the
  // gate independent of page state. Fine at this scale.
  const { session, sessionLoading, status, accessLoading } = useAuth()

  if (!REQUIRE_AUTH) return <>{children}</>

  if (sessionLoading) return <Splash>Checking session…</Splash>

  if (!session) {
    return (
      <Centered>
        <LoginForm />
      </Centered>
    )
  }

  // Only show the blocking spinner before the FIRST verdict. A background
  // re-check (token refresh, tab refocus) keeps the app mounted underneath.
  if (accessLoading && status === null) return <Splash>Checking access…</Splash>

  if (status === 'revoked') {
    return (
      <Centered>
        <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
          Your access has been removed
        </h2>
        <p className="pt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          An administrator revoked access for this account. If you think that was a mistake, ask
          them to restore it — waiting will not change anything.
        </p>
        <SignOutButton />
      </Centered>
    )
  }

  if (status !== 'approved') {
    return (
      <Centered>
        <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
          Awaiting approval
        </h2>
        <p className="pt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Your account exists but an administrator has not approved it yet. You will get in as soon
          as they do — try reloading after that.
        </p>
        <SignOutButton />
      </Centered>
    )
  }

  return <>{children}</>
}

function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="mt-4 rounded-lg px-3 py-1.5 text-[12px] font-medium"
      style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
    >
      Sign out
    </button>
  )
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-screen items-center justify-center font-mono text-[12px]"
      style={{ background: 'var(--page)', color: 'var(--muted)' }}
    >
      {children}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-screen items-center justify-center p-4"
      style={{ background: 'var(--page)' }}
    >
      <div
        className="w-[420px] max-w-[95vw] rounded-2xl p-6"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.12)',
        }}
      >
        <div className="flex items-center gap-2.5 pb-4">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg font-display text-[13px] font-bold text-white"
            style={{ background: 'var(--brand-navy)' }}
          >
            HZ
          </div>
          <div>
            <div className="font-display text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
              Haz Reviews
            </div>
            <div className="font-mono text-[9px]" style={{ color: 'var(--muted-3)' }}>
              hazreviews.com
            </div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
