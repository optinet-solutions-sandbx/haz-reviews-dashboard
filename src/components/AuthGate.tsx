import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { REQUIRE_AUTH, signOut } from '../lib/auth'
import { nextParamFor } from '../lib/authRedirect'
import { useAuth } from '../lib/useAuth'
import { AuthNotice, AuthShell } from './AuthShell'

/**
 * Whole-app session + approval gate. Active only when VITE_REQUIRE_AUTH is true.
 *
 * States: checking session → redirect to the portal → checking access → pending |
 * revoked | approved.
 *
 * A signed-out visitor is REDIRECTED to /login rather than shown a form in place.
 * The form-in-place version worked, but left sign-in with no address of its own:
 * nothing to bookmark, nothing to send someone, and no way for the app to return
 * the user to the page they were trying to reach. `nextParamFor` carries that
 * destination and `safeNextPath` refuses to honour an off-site one.
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
  const location = useLocation()

  if (!REQUIRE_AUTH) return <>{children}</>

  if (sessionLoading) return <Splash>Checking session…</Splash>

  if (!session) {
    return <Navigate to={nextParamFor(location.pathname, location.search)} replace />
  }

  // Only show the blocking spinner before the FIRST verdict. A background
  // re-check (token refresh, tab refocus) keeps the app mounted underneath.
  if (accessLoading && status === null) return <Splash>Checking access…</Splash>

  if (status === 'revoked') {
    return (
      <AuthShell footer={<SignOutButton />}>
        <AuthNotice title="Your access has been removed">
          An administrator revoked access for this account. If you think that was a mistake, ask
          them to restore it — waiting will not change anything.
        </AuthNotice>
      </AuthShell>
    )
  }

  if (status !== 'approved') {
    return (
      <AuthShell footer={<SignOutButton />}>
        <AuthNotice title="Awaiting approval">
          Your account exists but an administrator has not approved it yet. You will get in as soon
          as they do — try reloading after that.
        </AuthNotice>
      </AuthShell>
    )
  }

  return <>{children}</>
}

function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="mx-auto block rounded-lg px-3 py-1.5 text-[12px] font-medium"
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
