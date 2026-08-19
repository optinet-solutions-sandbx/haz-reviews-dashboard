import { describe, expect, it } from 'vitest'
import { resolveDevOverride, resolveGoogleAuth, resolveRequireAuth } from './devOverrides'

describe('resolveDevOverride', () => {
  // THE test that matters. The flag is a convenience for a machine with no
  // Supabase project behind it; if a production bundle could honour it, the
  // convenience would ship as an admin bypass.
  it('is ignored outside a dev build even when the flag is set', () => {
    expect(resolveDevOverride({ DEV: false, VITE_DEV_FORCE_ADMIN: 'true' })).toBeNull()
  })

  it('is off unless the flag is exactly true', () => {
    expect(resolveDevOverride({ DEV: true })).toBeNull()
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: 'false' })).toBeNull()
    // A present-but-empty var is how a commented-out line usually reads.
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: '' })).toBeNull()
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: '1' })).toBeNull()
  })

  it('grants admin with a placeholder address in a dev build', () => {
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: 'true' })).toEqual({
      isAdmin: true,
      email: 'dev@localhost',
    })
  })

  it('uses a supplied address so the footer can be checked with a real length', () => {
    expect(
      resolveDevOverride({
        DEV: true,
        VITE_DEV_FORCE_ADMIN: 'true',
        VITE_DEV_FORCE_EMAIL: 'jose@optinetsolutions.com',
      }),
    ).toEqual({ isAdmin: true, email: 'jose@optinetsolutions.com' })
  })

  it('falls back to the placeholder for a blank address', () => {
    expect(
      resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: 'true', VITE_DEV_FORCE_EMAIL: '' }),
    ).toEqual({ isAdmin: true, email: 'dev@localhost' })
  })
})

describe('resolveDevOverride in demo mode', () => {
  /**
   * The deployed demo is the only place these surfaces can render at all: there
   * is no Supabase project behind it, so `isAdmin` can never arrive from a real
   * session. Demo mode is a SEPARATE flag from VITE_DEV_FORCE_ADMIN on purpose.
   * The "ignored outside a dev build" test above must keep passing — a stray
   * dev flag in a deployed environment still does nothing — so consenting to a
   * public demo has to be its own explicit act rather than a side effect of a
   * leftover local variable.
   */
  it('grants admin in a production build', () => {
    expect(resolveDevOverride({ DEV: false, VITE_DEMO_MODE: 'true' })).toEqual({
      isAdmin: true,
      email: 'demo@example.com',
    })
  })

  // One flag, not two: the deployed build sets VITE_DEMO_MODE and nothing else.
  it('does not need the dev flag alongside it', () => {
    expect(resolveDevOverride({ VITE_DEMO_MODE: 'true' })).not.toBeNull()
  })

  it('is off unless the flag is exactly true', () => {
    expect(resolveDevOverride({ DEV: false, VITE_DEMO_MODE: 'false' })).toBeNull()
    expect(resolveDevOverride({ DEV: false, VITE_DEMO_MODE: '' })).toBeNull()
    expect(resolveDevOverride({ DEV: false, VITE_DEMO_MODE: '1' })).toBeNull()
  })

  /**
   * A reserved domain, and deliberately not dev's `dev@localhost`: a deployed
   * footer reading 'dev@localhost' looks like leaked local config, where this
   * reads as the demo it is.
   */
  it('shows a demo address rather than the local one', () => {
    expect(resolveDevOverride({ VITE_DEMO_MODE: 'true' })?.email).toBe('demo@example.com')
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: 'true' })?.email).toBe(
      'dev@localhost',
    )
  })

  it('still honours an explicitly supplied address', () => {
    expect(
      resolveDevOverride({ VITE_DEMO_MODE: 'true', VITE_DEV_FORCE_EMAIL: 'demo@optinet.test' })
        ?.email,
    ).toBe('demo@optinet.test')
  })
})

describe('resolveRequireAuth', () => {
  it('honours the flag in a normal build', () => {
    expect(resolveRequireAuth({ VITE_REQUIRE_AUTH: 'true' })).toBe(true)
    expect(resolveRequireAuth({ VITE_REQUIRE_AUTH: 'false' })).toBe(false)
    expect(resolveRequireAuth({})).toBe(false)
  })

  /**
   * Forced off in a demo build rather than left to configuration. A demo has no
   * auth backend, so the gate could never be passed: VITE_DEMO_MODE=true with
   * the gate left on deploys a login wall in front of data that is stand-in
   * anyway — which reads as a broken deploy rather than a misconfigured one.
   */
  it('cannot be on in a demo build', () => {
    expect(resolveRequireAuth({ VITE_REQUIRE_AUTH: 'true', VITE_DEMO_MODE: 'true' })).toBe(false)
  })
})

describe('resolveGoogleAuth', () => {
  /**
   * Opt-IN, unlike every other flag here, because the failure mode is the
   * reverse. "Continue with Google" throws `Unsupported provider` until a Google
   * OAuth client is configured in the Supabase project, and a portal that
   * strangers use should not offer a button that errors — a missing button reads
   * as "this app uses passwords", a broken one reads as "this app is broken".
   */
  it('is off unless explicitly enabled', () => {
    expect(resolveGoogleAuth({})).toBe(false)
    expect(resolveGoogleAuth({ VITE_ENABLE_GOOGLE_AUTH: '' })).toBe(false)
    expect(resolveGoogleAuth({ VITE_ENABLE_GOOGLE_AUTH: 'false' })).toBe(false)
  })

  it('requires exactly true, not merely something truthy', () => {
    // A commented-out line usually reads as an empty string, and 'yes' or '1'
    // would otherwise silently enable a provider nobody set up.
    expect(resolveGoogleAuth({ VITE_ENABLE_GOOGLE_AUTH: 'yes' })).toBe(false)
    expect(resolveGoogleAuth({ VITE_ENABLE_GOOGLE_AUTH: '1' })).toBe(false)
    expect(resolveGoogleAuth({ VITE_ENABLE_GOOGLE_AUTH: 'TRUE' })).toBe(false)
    expect(resolveGoogleAuth({ VITE_ENABLE_GOOGLE_AUTH: 'true' })).toBe(true)
  })

  it('stays off in a demo build even when enabled', () => {
    // A demo has no Supabase project behind it, so the provider cannot be
    // configured there by definition.
    expect(resolveGoogleAuth({ VITE_ENABLE_GOOGLE_AUTH: 'true', VITE_DEMO_MODE: 'true' })).toBe(
      false,
    )
  })
})
