import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthShell } from '../components/AuthShell'
import { LoginForm } from '../components/LoginForm'
import { safeNextPath } from '../lib/authRedirect'
import { REQUIRE_AUTH } from '../lib/auth'
import { useDocumentTitle } from '../lib/pageTitle'
import { useAuth } from '../lib/useAuth'

/**
 * The sign-in portal, at its own URL.
 *
 * It sits OUTSIDE AuthGate in App.tsx — a sign-in page behind a sign-in gate is
 * unreachable, because the gate renders its own form instead of the route.
 *
 * The gate sends people here with ?next=<where they were going>. That parameter
 * is attacker-controlled, so it goes through `safeNextPath` on every read rather
 * than being sanitised once and trusted afterwards.
 */
export function Login() {
  useDocumentTitle('Sign in')

  const location = useLocation()
  const navigate = useNavigate()
  // A third useAuth instance, alongside AuthGate's and Layout's. Each keeps its
  // own subscription; the cost is one extra approval lookup and the benefit is
  // that this page does not depend on the gate having mounted.
  const { session, sessionLoading } = useAuth()

  const next = safeNextPath(new URLSearchParams(location.search).get('next'))

  // Rendering the form first and redirecting after would flash a login form at
  // someone who is already signed in, which reads as having been signed out.
  if (sessionLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center font-mono text-[12px]"
        style={{ background: 'var(--page)', color: 'var(--muted)' }}
      >
        Checking session…
      </div>
    )
  }

  // Covers every way a session can appear, not just this form's own submit: the
  // OAuth redirect landing back here, and another tab signing in while this one
  // sits on the portal. A useAuth subscription re-renders on both, so no effect
  // is needed — an effect calling navigate() here would only duplicate this.
  if (session) return <Navigate to={next} replace />

  return (
    <AuthShell
      footer={
        !REQUIRE_AUTH && (
          /* Only offered when the gate is off, and then it is the truth rather
             than an escape hatch: the dashboard genuinely is browsable without a
             session in that configuration. Rendering it while the gate is ON
             would be a link straight back to this page. */
          <p className="text-center text-[11px]" style={{ color: 'var(--muted-3)' }}>
            <a href="/" className="text-glow" style={{ color: 'var(--muted)' }}>
              Continue without signing in
            </a>
          </p>
        )
      }
    >
      <LoginForm heading="h1" onSignedIn={() => navigate(next, { replace: true })} />
    </AuthShell>
  )
}
