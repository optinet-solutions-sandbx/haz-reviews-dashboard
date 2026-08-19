import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthNotice, AuthShell } from '../components/AuthShell'
import { MIN_PASSWORD_LENGTH, recoveryFromUrl, validateNewPassword } from '../lib/authRedirect'
import { updatePassword } from '../lib/auth'
import { useDocumentTitle } from '../lib/pageTitle'
import { useAuth } from '../lib/useAuth'

/**
 * Where the emailed recovery link lands. Until this existed, `sendPasswordReset`
 * pointed at a route that did not exist and the catch-all bounced the user to
 * Home — signed in, with no way to set the password they had just asked to
 * change, and nothing on screen to say so.
 *
 * Sits OUTSIDE AuthGate, and that is not optional: the recovery link establishes
 * a real session, so the gate would wave the user through to the dashboard and
 * this screen would never render. See `updatePassword`.
 */
export function ResetPassword() {
  useDocumentTitle('Reset password')

  // Read ONCE, in a state initialiser, and never again. supabase-js consumes the
  // recovery fragment and strips it from the URL as soon as the client
  // initialises, so anything reading window.location later sees a bare path and
  // concludes there was never a token.
  const [link] = useState(() => recoveryFromUrl(window.location.hash, window.location.search))

  const { session, sessionLoading } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateNewPassword(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await updatePassword(password)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // The link itself told us it was stale. Checked before the session states below
  // because it carries a specific reason worth repeating to the user, where a
  // missing session can only produce a guess.
  if (link.state === 'error') {
    return (
      <AuthShell footer={<BackToSignIn />}>
        <AuthNotice title="That link has expired">
          {/* Em dash rather than a full stop: `message` is a reason fragment and
              may be Supabase's own wording, which carries no terminal
              punctuation. */}
          {link.message} — reset links are single-use and short-lived, so request a fresh one from
          the sign-in page.
        </AuthNotice>
      </AuthShell>
    )
  }

  // Resolved BEFORE the two no-session branches below, even though it delays a
  // direct visitor by a moment. Testing `!session` while the lookup is still in
  // flight is true for every visitor, so those branches would flash their notice
  // at a signed-in user changing their own password before the form appeared.
  if (sessionLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center font-mono text-[12px]"
        style={{ background: 'var(--page)', color: 'var(--muted)' }}
      >
        Verifying your link…
      </div>
    )
  }

  if (!session) {
    return (
      <AuthShell footer={<BackToSignIn />}>
        {link.state === 'none' ? (
          <AuthNotice title="Nothing to reset">
            This page only works from the link in a password-reset email. Start from the sign-in
            page and choose “Forgot password?”.
          </AuthNotice>
        ) : (
          /* The URL claimed to be a recovery link but no session came of it — one
             that was already used, or whose tokens Supabase rejected without
             saying so in the fragment. */
          <AuthNotice title="That link is no longer valid">
            It may already have been used — reset links work once. Request a fresh one from the
            sign-in page.
          </AuthNotice>
        )}
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell>
        <AuthNotice title="Password updated">
          You are signed in with your new password. Keep it somewhere safe.
        </AuthNotice>
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="mt-4 w-full rounded-lg py-2 text-[12px] font-semibold text-white"
          style={{ background: 'var(--btn-ink)' }}
        >
          Go to the dashboard
        </button>
      </AuthShell>
    )
  }

  return (
    <AuthShell footer={<BackToSignIn />}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h1 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
          Choose a new password
        </h1>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Setting a password for <span className="font-mono">{session.user.email}</span>.
        </p>

        <Field
          label="New password"
          value={password}
          onChange={setPassword}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <Field label="Confirm new password" value={confirm} onChange={setConfirm} />

        {error && (
          <p className="text-[11px]" style={{ color: 'var(--neg)' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg py-2 text-[12px] font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--btn-ink)' }}
        >
          {busy ? 'Working…' : 'Set new password'}
        </button>
      </form>
    </AuthShell>
  )
}

/**
 * `minLength` is deliberately absent, unlike LoginForm's. Native validation would
 * block the submit with a browser tooltip and `validateNewPassword` would never
 * run — so the mismatch case, which the browser cannot check, would be reported
 * inconsistently with the length case.
 */
function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  /** Shown under the first field only. Repeating the rule under the confirmation
   *  field states it twice about one password. */
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </span>
      <input
        type="password"
        required
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg px-2.5 py-2 font-mono text-[12px] outline-none"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--ink)',
        }}
      />
      {hint && (
        <span className="text-[10px]" style={{ color: 'var(--muted-3)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

function BackToSignIn() {
  return (
    <p className="text-center text-[11px]" style={{ color: 'var(--muted-3)' }}>
      <Link to="/login" className="text-glow" style={{ color: 'var(--muted)' }}>
        Back to sign in
      </Link>
    </p>
  )
}
