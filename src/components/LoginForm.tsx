import { useState } from 'react'
import { sendPasswordReset, signIn, signInWithGoogle, signUp } from '../lib/auth'
import { GOOGLE_AUTH_ENABLED } from '../lib/devOverrides'

type Mode = 'signin' | 'signup' | 'reset'

const COPY: Record<Mode, { title: string; action: string }> = {
  signin: { title: 'Sign in', action: 'Sign in' },
  signup: { title: 'Create an account', action: 'Sign up' },
  reset: { title: 'Reset your password', action: 'Send reset link' },
}

/**
 * The shared credential form, used by the /login portal, the whole-app AuthGate
 * and the inline LoginModal, so the three can never drift apart in behaviour or
 * copy.
 *
 * `heading` exists for invariant 25 — a page gets exactly one <h1>. On the portal
 * this form's title IS the page title; in the modal the page underneath already
 * owns its <h1>, so the default stays 'h2'.
 */
export function LoginForm({
  onSignedIn,
  heading = 'h2',
}: {
  onSignedIn?: () => void
  heading?: 'h1' | 'h2'
}) {
  const Heading = heading
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        onSignedIn?.()
      } else if (mode === 'signup') {
        await signUp(email, password)
        setNotice('Account created. An admin needs to approve it before you can make changes.')
      } else {
        await sendPasswordReset(email)
        setNotice('If that address has an account, a reset link is on its way.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Heading className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
        {COPY[mode].title}
      </Heading>

      <label className="flex flex-col gap-1">
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: 'var(--muted)' }}
        >
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg px-2.5 py-2 font-mono text-[12px] outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
        />
      </label>

      {mode !== 'reset' && (
        <label className="flex flex-col gap-1">
          <span
            className="text-[9px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: 'var(--muted)' }}
          >
            Password
          </span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg px-2.5 py-2 font-mono text-[12px] outline-none"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          />
        </label>
      )}

      {error && (
        <p className="text-[11px]" style={{ color: 'var(--neg)' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="text-[11px]" style={{ color: 'var(--pos)' }}>
          {notice}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg py-2 text-[12px] font-semibold text-white disabled:opacity-60"
        style={{ background: 'var(--btn-ink)' }}
      >
        {busy ? 'Working…' : COPY[mode].action}
      </button>

      {/* Hidden unless a Google OAuth client is actually configured in the
          Supabase project. signInWithOAuth throws 'Unsupported provider'
          otherwise, and an erroring button on the first screen a new user sees
          reads as a broken app rather than as an unconfigured provider. */}
      {GOOGLE_AUTH_ENABLED && (
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="rounded-lg py-2 text-[12px] font-medium"
          style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
        >
          Continue with Google
        </button>
      )}

      <div className="flex justify-between text-[11px]">
        <button
          type="button"
          className="text-glow"
          style={{ color: 'var(--muted)' }}
          onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
        >
          {mode === 'signup' ? 'I already have an account' : 'Create an account'}
        </button>
        <button
          type="button"
          className="text-glow"
          style={{ color: 'var(--muted)' }}
          onClick={() => setMode(mode === 'reset' ? 'signin' : 'reset')}
        >
          {mode === 'reset' ? 'Back to sign in' : 'Forgot password?'}
        </button>
      </div>

      {/* Google OAuth reloads the page, so a pending action captured by
          requireAuth cannot survive it. Saying so beats a silent no-op — but only
          where the button it describes is actually rendered. */}
      {GOOGLE_AUTH_ENABLED && (
        <p className="text-[10px] leading-snug" style={{ color: 'var(--muted-3)' }}>
          Signing in with Google reloads the page — you may need to click what you were
          doing again.
        </p>
      )}
    </form>
  )
}
