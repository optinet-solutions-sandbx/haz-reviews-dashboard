import { describe, expect, it } from 'vitest'
import { nextParamFor, recoveryFromUrl, safeNextPath, validateNewPassword } from './authRedirect'

describe('safeNextPath', () => {
  it('returns an in-app path unchanged', () => {
    expect(safeNextPath('/rankings')).toBe('/rankings')
  })

  it('keeps a query string and hash, which carry the view the user wanted', () => {
    expect(safeNextPath('/hazreviews/rankings?market=AE#top')).toBe(
      '/hazreviews/rankings?market=AE#top',
    )
  })

  it('falls back to the root for a missing or empty value', () => {
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath('')).toBe('/')
    expect(safeNextPath('   ')).toBe('/')
  })

  it('refuses an absolute URL to another origin', () => {
    // The whole point of sanitising this parameter. `next` arrives from the
    // address bar, so a link to /login?next=https://evil.com/harvest would
    // otherwise bounce a freshly signed-in user onto an attacker's page that can
    // present a convincing "session expired, sign in again" form.
    expect(safeNextPath('https://evil.com/harvest')).toBe('/')
    expect(safeNextPath('http://evil.com')).toBe('/')
  })

  it('refuses a protocol-relative URL', () => {
    // The trap this function exists for: '//evil.com' passes a naive
    // startsWith('/') check and is still a fully qualified off-site URL to
    // every browser.
    expect(safeNextPath('//evil.com')).toBe('/')
    expect(safeNextPath('//evil.com/harvest')).toBe('/')
  })

  it('refuses a backslash-disguised origin', () => {
    // Browsers normalise a backslash to a forward slash in the authority
    // position, so '/\evil.com' and '\\evil.com' navigate off-site just like
    // '//evil.com' does, while reading as a harmless relative path.
    expect(safeNextPath('/\\evil.com')).toBe('/')
    expect(safeNextPath('\\\\evil.com')).toBe('/')
  })

  it('refuses a value that is not rooted at a slash', () => {
    expect(safeNextPath('evil.com')).toBe('/')
    expect(safeNextPath('javascript:alert(1)')).toBe('/')
  })

  it('refuses a value carrying a control character', () => {
    // A tab or newline inside the scheme is stripped by the browser before it
    // resolves the URL, so 'java\tscript:' becomes a live scheme again after our
    // check has already looked at it and seen something harmless.
    expect(safeNextPath('/\tevil')).toBe('/')
    expect(safeNextPath('java\tscript:alert(1)')).toBe('/')
    expect(safeNextPath('/foo\nbar')).toBe('/')
  })

  it('never sends the user back to a sign-in surface', () => {
    // Landing on /login?next=/login would sign the user in and return them to
    // the portal, which reads as a failed sign-in rather than a loop.
    expect(safeNextPath('/login')).toBe('/')
    expect(safeNextPath('/login?next=/login')).toBe('/')
    expect(safeNextPath('/reset-password')).toBe('/')
  })

  it('does not mistake a real page for a sign-in surface', () => {
    // A prefix check would swallow any future path that merely starts with
    // those words.
    expect(safeNextPath('/login-history')).toBe('/login-history')
  })
})

describe('nextParamFor', () => {
  it('builds a sign-in URL that remembers where the user was going', () => {
    expect(nextParamFor('/hazreviews/rankings', '?market=AE')).toBe(
      '/login?next=%2Fhazreviews%2Frankings%3Fmarket%3DAE',
    )
  })

  it('omits the parameter when the destination is the root', () => {
    // '/login?next=%2F' is noise in the address bar and means nothing more than
    // '/login' does.
    expect(nextParamFor('/', '')).toBe('/login')
  })

  it('omits the parameter for a sign-in surface', () => {
    expect(nextParamFor('/login', '')).toBe('/login')
  })
})

describe('recoveryFromUrl', () => {
  it('recognises a recovery link', () => {
    // Supabase returns the tokens in the FRAGMENT, so they never reach a server
    // log. supabase-js reads them itself; all this has to decide is which
    // screen to render.
    const hash = '#access_token=abc&refresh_token=def&type=recovery&expires_in=3600'
    expect(recoveryFromUrl(hash, '')).toEqual({ state: 'recovery' })
  })

  it('recognises the PKCE variant, which carries a code in the query', () => {
    expect(recoveryFromUrl('', '?code=abc123')).toEqual({ state: 'recovery' })
  })

  it('surfaces an expired link as an error rather than a password form', () => {
    // Without this the screen offers a password field, the submit fails with a
    // raw "Auth session missing!", and the user retypes a password they were
    // never going to be able to set. The link being stale is the actual
    // problem and it is knowable before they type anything.
    const hash =
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    expect(recoveryFromUrl(hash, '')).toEqual({
      state: 'error',
      message: 'Email link is invalid or has expired',
    })
  })

  it('falls back to a generic reason when the link carries no description', () => {
    expect(recoveryFromUrl('#error=access_denied', '')).toEqual({
      state: 'error',
      message: 'That reset link is not valid',
    })
  })

  it('returns the reason as a fragment, with no terminal punctuation', () => {
    // The caller joins this onto its own guidance sentence. Supabase's
    // error_description arrives unpunctuated, so the fallback matches that shape
    // — otherwise the two concatenate into '...not valid. Request a new one. —
    // reset links are single-use', which reads as two authors.
    const messages = [
      recoveryFromUrl('#error=access_denied', ''),
      recoveryFromUrl('#error=access_denied&error_description=Email+link+is+invalid', ''),
    ]
    for (const result of messages) {
      expect(result.state).toBe('error')
      if (result.state !== 'error') continue
      expect(result.message).not.toMatch(/[.!?]$/)
    }
  })

  it('reports neither for a plain visit to the page', () => {
    // Someone typing /reset-password directly has no token, so the screen must
    // explain that instead of silently doing nothing.
    expect(recoveryFromUrl('', '')).toEqual({ state: 'none' })
    expect(recoveryFromUrl('#', '?')).toEqual({ state: 'none' })
  })

  it('ignores a non-recovery token type', () => {
    // A signup-confirmation link lands with type=signup. It is a valid session
    // but not a mandate to change the password.
    expect(recoveryFromUrl('#access_token=abc&type=signup', '')).toEqual({ state: 'none' })
  })
})

describe('validateNewPassword', () => {
  it('accepts a long enough matching pair', () => {
    expect(validateNewPassword('correct-horse-battery', 'correct-horse-battery')).toBeNull()
  })

  it('rejects a password shorter than the sign-up minimum', () => {
    // Must match LoginForm's minLength of 8, or an account can be created with
    // a password the reset screen would refuse.
    expect(validateNewPassword('short7', 'short7')).toBe('Password must be at least 8 characters.')
  })

  it('rejects a mismatched confirmation', () => {
    // The confirmation field exists because a shared account on a domain nobody
    // owns cannot receive a reset email — a typo here is unrecoverable without
    // database access.
    expect(validateNewPassword('longenough1', 'longenough2')).toBe('The two passwords do not match.')
  })

  it('reports the length problem before the mismatch', () => {
    // Both are wrong here. Naming the length first is the actionable one: the
    // user has to change both fields anyway.
    expect(validateNewPassword('abc', 'xyz')).toBe('Password must be at least 8 characters.')
  })

  it('does not trim the password', () => {
    // A leading or trailing space is a legitimate part of a password, and
    // trimming it here would set something different from what the user typed —
    // then fail at sign-in with no explanation.
    expect(validateNewPassword('  spaced  ', '  spaced  ')).toBeNull()
  })
})
