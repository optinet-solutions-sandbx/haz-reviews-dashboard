import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LoginForm } from '../components/LoginForm'
import { safeNextPath } from '../lib/authRedirect'
import { useDocumentTitle } from '../lib/pageTitle'
import { useAuth } from '../lib/useAuth'

/**
 * The sign-in portal, ported to the shell's login spec (`docs/login-spec.md`).
 *
 * Sits OUTSIDE AuthGate in App.tsx — a sign-in page behind a sign-in gate is
 * unreachable, because the gate renders its own decision instead of the route.
 *
 * The gate sends people here with ?next=<where they were going>. That parameter is
 * attacker-controlled, so it goes through `safeNextPath` on every read rather than
 * being sanitised once and trusted afterwards.
 *
 * Does NOT use AuthShell. The spec's card is top-weighted (64px from the top, not
 * vertically centred) and carries no monogram, where AuthShell centres a branded
 * card — which is still right for the gate's pending/revoked notices, so both exist.
 */
export function Login() {
  useDocumentTitle('Sign in')

  const location = useLocation()
  const navigate = useNavigate()
  // A third useAuth instance, alongside AuthGate's and Layout's. Each keeps its own
  // subscription; the cost is one extra approval lookup and the benefit is that this
  // page does not depend on the gate having mounted.
  const { session, sessionLoading } = useAuth()

  const next = safeNextPath(new URLSearchParams(location.search).get('next'))

  // Rendering the form first and redirecting after would flash a login form at
  // someone who is already signed in, which reads as having been signed out.
  if (sessionLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-sub" style={{ margin: 0 }}>
            Checking session…
          </p>
        </div>
      </div>
    )
  }

  // Covers every way a session can appear, not just this form's own submit: another
  // tab signing in while this one sits on the portal. A useAuth subscription
  // re-renders on that, so no effect is needed — one calling navigate() here would
  // only duplicate this.
  if (session) return <Navigate to={next} replace />

  return (
    <div className="login-page">
      <div className="login-card">
        {/* The app's name is the page's single <h1> (invariant 25); "Sign in to
            continue" is a <p>, not a second heading. The spec's own heading slot is
            the product name, so this is the port of it, not a substitution. */}
        <h1>Haz Reviews</h1>
        <p className="login-sub">Sign in to continue</p>
        <LoginForm onSignedIn={() => navigate(next, { replace: true })} />
      </div>
    </div>
  )
}
