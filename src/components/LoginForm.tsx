import { useState } from 'react'
import { signIn } from '../lib/auth'

/**
 * The credential form, shared by the /login portal and the inline LoginModal that
 * `requireAuth` opens, so the two cannot drift apart.
 *
 * Sign-in ONLY. Sign-up, password reset and Google were removed on 2026-08-19 when
 * this screen was ported to the shell's login spec (`docs/login-spec.md`), which has
 * none of them. That suits a tool used by one small group: accounts are created in
 * the Supabase dashboard, so there is no self-registration into the pending queue,
 * and `/reset-password` still works from a link an admin triggers there.
 *
 * The heading lives on the PAGE, not here — `/login` renders the app name as its
 * single <h1> with "Sign in to continue" beneath it (invariant 25). This component
 * deliberately renders no heading of its own, which is also what lets the modal
 * reuse it without introducing a second one.
 */
export function LoginForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email, password)
      onSignedIn?.()
    } catch {
      // ONE generic message, and deliberately not the provider's. Supabase already
      // answers "Invalid login credentials" for a wrong password, but it is specific
      // for other failures — an unconfirmed email says so, which tells an attacker
      // the address exists. Collapsing every credential failure to one string denies
      // account enumeration. The spec calls this out and it is worth keeping.
      //
      // The cost is real and accepted: a genuine outage now reads as a bad password.
      // The readiness probe and `npm run verify:supabase` are where that gets
      // diagnosed instead.
      setError('Invalid email or password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="login-form"
      onSubmit={submit}
      // Points at the error only while one exists, so a screen reader is not told
      // the form is described by an empty node.
      aria-describedby={error ? 'login-form-error' : undefined}
    >
      <div>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {/* Between the password and the button, per the spec's vertical rhythm, and
          role="alert" so it announces on appearance rather than only on focus. */}
      {error && (
        <p className="login-error" id="login-form-error" role="alert">
          {error}
        </p>
      )}

      <button className="login-submit" type="submit" disabled={busy}>
        {/* A single U+2026, not three periods — the spec is explicit, and three dots
            reflow at a different width as the label changes. */}
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
