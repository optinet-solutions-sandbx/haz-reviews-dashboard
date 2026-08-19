import type { ReactNode } from 'react'

/**
 * The branded card every unauthenticated screen sits in: the portal at /login,
 * the gate's pending/revoked notices, and the password-reset screen.
 *
 * Extracted from AuthGate's private `Centered` for the same reason `LoginForm` is
 * shared between the gate and the modal — three copies of a brand header drift,
 * and the drift shows up on exactly the screens a new user sees first.
 *
 * The monogram is hardcoded rather than read from the site registry. This is the
 * APP's identity, not the active property's, and there is no active property
 * before sign-in — `siteMonogram` would need a site id that does not exist yet.
 * Same distinction `pageTitle` draws (invariant 25's neighbour): HAZREVIEWS
 * currently shares the app's name, which is precisely when the difference is
 * easiest to lose.
 */
export function AuthShell({
  children,
  footer,
}: {
  children: ReactNode
  /** Optional row under the card — sign-out on the gate, a back link elsewhere. */
  footer?: ReactNode
}) {
  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: 'var(--page)' }}
    >
      <div className="w-[420px] max-w-[95vw]">
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            boxShadow: 'var(--shadow-modal)',
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
              <div
                className="font-display text-[14px] font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                Haz Reviews
              </div>
              <div className="font-mono text-[9px]" style={{ color: 'var(--muted-3)' }}>
                hazreviews.com
              </div>
            </div>
          </div>
          {children}
        </div>
        {footer && <div className="pt-3">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * A short explanatory screen inside the shell — "awaiting approval", "link
 * expired". Kept here so those notices cannot drift from each other either.
 */
export function AuthNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </h1>
      <p className="pt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {children}
      </p>
    </>
  )
}
