/**
 * Pure helpers for the sign-in portal and the password-reset screen.
 *
 * They live in their own module rather than beside the components because the
 * test environment is `node`: importing anything that reaches `auth.ts` pulls in
 * the Supabase client, which throws at module load without credentials. Same
 * reason `resolveRequireAuth` sits in `devOverrides.ts`.
 */

/**
 * Paths that must never be a post-sign-in destination.
 *
 * Matched EXACTLY, not by prefix — a prefix test would also swallow any future
 * page whose name merely begins with one of these.
 */
const SIGN_IN_PATHS = new Set(['/login', '/reset-password'])

/**
 * True if the value carries anything a browser strips or reinterprets before it
 * resolves a URL — C0 controls or DEL.
 *
 * A char-code loop rather than a regex character class, because the class would
 * need either literal control bytes (invisible in an editor and in a diff, so
 * the next reader cannot tell what it covers) or escapes that are easy to mangle
 * when this file is edited by tooling.
 */
function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Sanitises the `next` query parameter into a path this app can navigate to.
 *
 * `next` arrives from the address bar, so it is attacker-controlled: a mailed
 * link to `/login?next=https://evil.com` would otherwise hand a user who has
 * just typed their password off to a page that can show them a convincing
 * "session expired" form. Anything that is not plainly an in-app path collapses
 * to '/', because a silent fallback is the correct failure here — there is no
 * useful way to tell a user their redirect looked hostile.
 *
 * Rejecting non-'/' prefixes is NOT sufficient on its own. `//evil.com` and
 * `/\evil.com` both start with a slash and both navigate off-site, the second
 * because browsers normalise a backslash to a forward slash in the authority
 * position.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/'

  const value = raw.trim()
  if (!value) return '/'
  // Checked before anything else: a tab inside 'java\tscript:' is removed by the
  // browser, so the scheme becomes live again after a naive check has already
  // inspected the string and found nothing alarming.
  if (hasControlChar(value)) return '/'
  if (!value.startsWith('/')) return '/'
  if (value.startsWith('//') || value.startsWith('/\\')) return '/'

  const path = value.split(/[?#]/)[0]
  if (SIGN_IN_PATHS.has(path)) return '/'

  return value
}

/**
 * The portal URL that remembers where someone was headed before the gate
 * stopped them.
 *
 * Runs the destination back through `safeNextPath` rather than trusting the
 * caller, so a hostile value cannot be laundered by being written into the link
 * we generate ourselves.
 */
export function nextParamFor(pathname: string, search: string): string {
  const target = safeNextPath(`${pathname}${search}`)
  // '/login?next=%2F' says nothing that '/login' does not, and a bare portal URL
  // is what a user expects to see when they signed out deliberately.
  if (target === '/') return '/login'
  return `/login?next=${encodeURIComponent(target)}`
}

export type RecoveryState =
  | { state: 'recovery' }
  | { state: 'error'; message: string }
  | { state: 'none' }

/**
 * Unpunctuated on purpose. `message` is a REASON FRAGMENT that the screen joins
 * onto its own guidance sentence, and Supabase's `error_description` arrives in
 * exactly that shape — so a fallback written as a finished sentence would make
 * the two concatenate into something that reads as two authors.
 */
const GENERIC_LINK_ERROR = 'That reset link is not valid'

/**
 * Which of the three password-reset screens to render.
 *
 * Supabase delivers recovery credentials two ways depending on the project's
 * flow: the implicit flow puts `type=recovery` plus the tokens in the URL
 * FRAGMENT, which never reaches a server log, and PKCE puts a `code` in the
 * query. supabase-js consumes whichever itself — this only has to pick a screen.
 *
 * The error branch is the one that earns its keep. A stale link arrives as
 * `#error=access_denied&error_code=otp_expired`, and without reading it the page
 * would offer a password field, fail the submit with a raw "Auth session
 * missing!", and leave the user retyping a password they were never going to be
 * able to set. That the link expired is knowable before they type anything.
 */
export function recoveryFromUrl(hash: string, search: string): RecoveryState {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  const query = new URLSearchParams(search.replace(/^\?/, ''))

  const error = fragment.get('error') ?? query.get('error')
  if (error) {
    const description = fragment.get('error_description') ?? query.get('error_description')
    return { state: 'error', message: description || GENERIC_LINK_ERROR }
  }

  // `type` is checked rather than the mere presence of a token: a signup
  // confirmation also lands here with a valid session, and that is not a mandate
  // to change the password.
  if (fragment.get('type') === 'recovery') return { state: 'recovery' }
  if (query.get('code')) return { state: 'recovery' }

  return { state: 'none' }
}

/**
 * Kept in step with LoginForm's `minLength`, or sign-up could create a password
 * that the reset screen then refuses.
 */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Validates a new password against its confirmation. Returns the message to
 * show, or null when the pair is good.
 *
 * The confirmation field is not ceremony here: a shared account on a domain
 * nobody owns cannot receive a reset email, so a typo would be unrecoverable
 * without database access.
 *
 * Deliberately does NOT trim. A leading or trailing space is a legitimate part
 * of a password, and trimming would set something other than what was typed —
 * then fail at the next sign-in with nothing to explain why.
 */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}
